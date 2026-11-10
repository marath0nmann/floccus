import { IAccountData } from './interfaces/AccountStorage'

/**
 * Profiles configured by an administrator through the browser's managed
 * storage (`storage.managed`, filled from enterprise policies -- see
 * doc/ManagedPolicy.md and managed_schema.json).
 *
 * This module only interprets the policy and works out what has to change; it
 * doesn't touch the browser. BrowserManagedPolicy applies the result.
 */

/** Where the synced folder is, as the policy names it */
export type TLocalRootPreset = 'toolbar' | 'other' | 'menu' | 'root'

export const LOCAL_ROOT_PRESETS: TLocalRootPreset[] = ['toolbar', 'other', 'menu', 'root']

/** The profile types a policy may create */
export const MANAGED_ACCOUNT_TYPES = ['webdav', 'nextcloud-bookmarks'] as const

/**
 * The profile settings a policy may set, with the type they must have.
 *
 * Passwords and passphrases are deliberately not among them: policies are
 * readable by every user of the machine (on Windows they sit in the registry),
 * and a profile that needs a password gets it from its user, who can still
 * enter it unless the profile is locked.
 */
const SETTINGS: Record<string, 'string' | 'boolean' | 'integer'> = {
  url: 'string',
  username: 'string',
  serverRoot: 'string',
  bookmark_file: 'string',
  bookmark_file_type: 'string',
  includeCredentials: 'boolean',
  allowRedirects: 'boolean',
  label: 'string',
  strategy: 'string',
  enabled: 'boolean',
  syncIntervalEnabled: 'boolean',
  syncInterval: 'integer',
  syncOnStartupEnabled: 'boolean',
  failsafe: 'boolean',
  nestedSync: 'boolean',
}

const ENUMS: Record<string, string[]> = {
  bookmark_file_type: ['xbel', 'html'],
  strategy: ['default', 'slave', 'overwrite'],
}

/**
 * Settings that decide what the profile syncs. When one of them changes, the
 * cache and the mappings describe a different pair of trees and the profile has
 * to start over, like it does when its user changes them (STORE_ACCOUNT).
 */
const STRUCTURAL_SETTINGS = ['url', 'serverRoot', 'bookmark_file', 'bookmark_file_type', 'localRoot']

/**
 * What a profile created by a policy starts out with, unless the policy says
 * otherwise. The same as a profile set up by hand, except that it also syncs on
 * startup: nobody is going to come and press the sync button.
 */
const CREATE_DEFAULTS: Partial<IAccountData> = {
  enabled: true,
  syncIntervalEnabled: true,
  syncOnStartupEnabled: true,
  strategy: 'default',
}

export interface IManagedAccountPolicy {
  /** Stable identifier the profile is recognized by across policy updates */
  id: string
  type: typeof MANAGED_ACCOUNT_TYPES[number]
  localRootPreset: TLocalRootPreset
  /** Users can neither change nor delete the profile */
  lockSettings: boolean
  /** The profile settings the policy sets, see SETTINGS */
  settings: Partial<IAccountData>
}

export interface IManagedPolicy {
  accounts: IManagedAccountPolicy[]
}

export interface IExistingAccount {
  id: string
  data: IAccountData
  syncing?: boolean
}

export interface IManagedPolicyPlan {
  create: Partial<IAccountData>[]
  update: { accountId: string, data: Partial<IAccountData>, reinitialize: boolean }[]
  /** Profiles whose type changed: an adapter can't change its type, so they are made anew */
  replace: { accountId: string, data: Partial<IAccountData> }[]
  /** Profiles no longer in the policy. They become ordinary profiles. */
  release: string[]
  /** Profiles left alone for now because they are syncing, see planManagedAccounts */
  deferred: string[]
}

type TLog = (message: string) => void

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const noLog: TLog = (message) => undefined

/**
 * Registry-backed policies don't always come out with the types the schema
 * describes: Firefox turns a list into an object of numbered keys, a REG_DWORD
 * into a number. Take what is unambiguous.
 */
function coerce(value: any, type: 'string' | 'boolean' | 'integer'): any {
  if (type === 'string') {
    return typeof value === 'string' ? value : undefined
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    if (value === 0 || value === 1) return Boolean(value)
    if (value === 'true' || value === 'false') return value === 'true'
    return undefined
  }
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return Number.isInteger(number) ? number : undefined
}

function toList(value: any): any[] | undefined {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch (e) {
      return undefined
    }
  }
  if (Array.isArray(value)) {
    return value
  }
  if (value && typeof value === 'object') {
    // { "1": {...}, "2": {...} }, ordered by key
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
      .map(key => value[key])
  }
  return undefined
}

function parseAccount(entry: any, index: number, log: TLog): IManagedAccountPolicy | null {
  if (typeof entry === 'string') {
    try {
      entry = JSON.parse(entry)
    } catch (e) {
      // handled below
    }
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    log(`Managed policy: ignoring account #${index}, not an object`)
    return null
  }
  const id = coerce(entry.id, 'string')
  if (!id) {
    log(`Managed policy: ignoring account #${index}, it has no id`)
    return null
  }
  const type = coerce(entry.type, 'string') || 'webdav'
  if (!(MANAGED_ACCOUNT_TYPES as readonly string[]).includes(type)) {
    log(`Managed policy: ignoring account ${id}, unsupported type ${type}`)
    return null
  }
  const url = coerce(entry.url, 'string')
  if (!url) {
    log(`Managed policy: ignoring account ${id}, it has no url`)
    return null
  }
  const localRootPreset = coerce(entry.localRootPreset, 'string') || 'toolbar'
  if (!(LOCAL_ROOT_PRESETS as string[]).includes(localRootPreset)) {
    log(`Managed policy: ignoring account ${id}, unknown localRootPreset ${localRootPreset}`)
    return null
  }

  const settings: Partial<IAccountData> = {}
  for (const [key, settingType] of Object.entries(SETTINGS)) {
    if (!(key in entry)) continue
    const value = coerce(entry[key], settingType)
    if (typeof value === 'undefined' || (ENUMS[key] && !ENUMS[key].includes(value))) {
      log(`Managed policy: ignoring invalid value of ${key} for account ${id}`)
      continue
    }
    settings[key] = value
  }
  if ('syncInterval' in settings && settings.syncInterval < 1) {
    delete settings.syncInterval
  }
  for (const secret of ['password', 'passphrase']) {
    if (secret in entry) {
      log(`Managed policy: ignoring ${secret} for account ${id}, secrets are not taken from policies`)
    }
  }

  return {
    id,
    type: type as IManagedAccountPolicy['type'],
    localRootPreset: localRootPreset as TLocalRootPreset,
    lockSettings: coerce(entry.lockSettings, 'boolean') || false,
    settings,
  }
}

/**
 * Interpret the contents of `storage.managed`.
 *
 * Returns null if there is no policy for us at all, which is not the same as a
 * policy without accounts: without a policy nothing is touched, while an empty
 * list releases the profiles an earlier policy created.
 */
export function parseManagedPolicy(raw: any, log: TLog = noLog): IManagedPolicy | null {
  if (!raw || typeof raw !== 'object' || !('accounts' in raw)) {
    return null
  }
  const list = toList(raw.accounts)
  if (!list) {
    log('Managed policy: ignoring it, "accounts" is not a list')
    return null
  }
  const accounts: IManagedAccountPolicy[] = []
  list.forEach((entry, i) => {
    const account = parseAccount(entry, i, log)
    if (!account) return
    if (accounts.some(a => a.id === account.id)) {
      log(`Managed policy: ignoring duplicate account id ${account.id}`)
      return
    }
    accounts.push(account)
  })
  return { accounts }
}

/**
 * The account data a policy entry stands for, once its local folder is known
 */
export function managedAccountData(policy: IManagedAccountPolicy, localRoot: string): Partial<IAccountData> {
  const settings = { type: policy.type, ...policy.settings, localRoot }
  return {
    ...settings,
    managedId: policy.id,
    managedKeys: Object.keys(settings).sort(),
    managedLocked: policy.lockSettings,
  }
}

function sameValue(a: any, b: any): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
  }
  return a === b
}

/**
 * Work out what has to change for the existing profiles to match the policy.
 *
 * @param resolveLocalRoot - the bookmark folder id of a preset, or null if this
 *   browser doesn't have that folder (the entry is then skipped)
 */
export function planManagedAccounts(
  policy: IManagedPolicy,
  accounts: IExistingAccount[],
  resolveLocalRoot: (preset: TLocalRootPreset) => string | null,
  log: TLog = noLog
): IManagedPolicyPlan {
  const plan: IManagedPolicyPlan = { create: [], update: [], replace: [], release: [], deferred: [] }
  const claimed = new Set<string>()

  for (const entry of policy.accounts) {
    const localRoot = resolveLocalRoot(entry.localRootPreset)
    if (!localRoot) {
      log(`Managed policy: skipping account ${entry.id}, this browser has no "${entry.localRootPreset}" folder`)
      continue
    }
    const wanted = managedAccountData(entry, localRoot)
    const existing = accounts.find(acc => acc.data.managedId === entry.id && !claimed.has(acc.id))
    if (!existing) {
      plan.create.push({ ...CREATE_DEFAULTS, ...wanted })
      continue
    }
    claimed.add(existing.id)

    if (existing.data.type !== entry.type) {
      if (existing.syncing) {
        plan.deferred.push(existing.id)
      } else {
        plan.replace.push({ accountId: existing.id, data: { ...CREATE_DEFAULTS, ...wanted } })
      }
      continue
    }

    const changed = Object.keys(wanted).filter(key => !sameValue(existing.data[key], wanted[key]))
    if (!changed.length) {
      continue
    }
    const reinitialize = changed.some(key => STRUCTURAL_SETTINGS.includes(key))
    if (reinitialize && existing.syncing) {
      // Pulling the server or the folder out from under a running sync would
      // mix up two trees. Try again on the next round.
      plan.deferred.push(existing.id)
      continue
    }
    const data = {}
    for (const key of changed) {
      data[key] = wanted[key]
    }
    plan.update.push({ accountId: existing.id, data, reinitialize })
  }

  for (const acc of accounts) {
    if (acc.data.managedId && !claimed.has(acc.id) && !policy.accounts.some(e => e.id === acc.data.managedId)) {
      plan.release.push(acc.id)
    }
  }
  // A profile whose policy entry was skipped above (no such folder here) is
  // neither claimed nor released: it stays as it is.
  return plan
}

/** What releasing a profile from the policy changes in its data */
export const RELEASED_ACCOUNT_DATA: Partial<IAccountData> = {
  managedId: undefined,
  managedKeys: undefined,
  managedLocked: undefined,
}

/** The account data that marks a profile as managed, see Account.import/export */
export const MANAGED_ACCOUNT_DATA = ['managedId', 'managedKeys', 'managedLocked'] as const
