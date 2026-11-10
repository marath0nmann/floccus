import browser from '../browser-api'
import AsyncLock from 'async-lock'
import Account from '../Account'
import AdapterFactory from '../AdapterFactory'
import Logger from '../Logger'
import BrowserTree from './BrowserTree'
import {
  IManagedPolicy,
  IManagedPolicyPlan,
  parseManagedPolicy,
  planManagedAccounts,
  RELEASED_ACCOUNT_DATA
} from '../ManagedPolicy'

const lock = new AsyncLock()

/**
 * What the administrator put into `storage.managed`, or null if there is
 * nothing. Firefox rejects the call when no policy names the extension, other
 * browsers may not have managed storage at all.
 */
export async function readManagedPolicy(): Promise<IManagedPolicy | null> {
  if (!browser.storage || !browser.storage.managed) {
    return null
  }
  let raw
  try {
    raw = await browser.storage.managed.get(null)
  } catch (e) {
    return null
  }
  return parseManagedPolicy(raw, (message) => Logger.log(message))
}

/**
 * Make the profiles match the managed policy: create the ones it lists, update
 * the ones it changed, and turn the ones it no longer lists into ordinary
 * profiles. Does nothing without a policy.
 *
 * Runs once at a time, so that the start of the background script and a policy
 * change arriving with it can't both create the same profile.
 *
 * @returns whether any profile was changed
 */
export function applyManagedPolicy(): Promise<boolean> {
  return lock.acquire('managed-policy', async() => {
    const policy = await readManagedPolicy()
    if (!policy) {
      return false
    }
    const { accountsLocked } = await browser.storage.local.get({ accountsLocked: null })
    if (accountsLocked) {
      // Profiles are still encrypted with the legacy key; unlock() would try to
      // decrypt one we added in plain text. Wait until they are unlocked.
      Logger.log('Managed policy: profiles are locked, not applying the policy yet')
      return false
    }

    const accounts = await Account.getAllAccounts()
    const folders = await BrowserTree.getBuiltInFolders()
    const plan = planManagedAccounts(
      policy,
      accounts.map(acc => ({ id: acc.id, data: acc.getData(), syncing: Boolean(acc.getData().syncing || acc.syncing) })),
      (preset) => folders[preset] || null,
      (message) => Logger.log(message)
    )
    await executePlan(plan)
    return Boolean(plan.create.length || plan.update.length || plan.replace.length || plan.release.length)
  })
}

async function createAccount(data) {
  const account = await Account.create({
    ...(await AdapterFactory.getDefaultValues(data.type)),
    // The defaults are examples, not something to log in with
    username: '',
    password: '',
    passphrase: '',
    ...data,
  })
  Logger.log('Managed policy: created profile ' + account.id + ' for ' + data.managedId)
  return account
}

async function executePlan(plan: IManagedPolicyPlan) {
  for (const data of plan.create) {
    try {
      await createAccount(data)
    } catch (e) {
      Logger.log('Managed policy: could not create profile for ' + data.managedId + ': ' + e.message)
    }
  }
  for (const { accountId, data, reinitialize } of plan.update) {
    try {
      const account = await Account.get(accountId)
      await account.setData(data)
      if (reinitialize) {
        await account.init()
      }
      Logger.log('Managed policy: updated profile ' + accountId + ' (' + Object.keys(data).join(', ') + ')')
    } catch (e) {
      Logger.log('Managed policy: could not update profile ' + accountId + ': ' + e.message)
    }
  }
  for (const { accountId, data } of plan.replace) {
    try {
      const account = await Account.get(accountId)
      await account.delete()
      delete Account.cache[accountId]
      await createAccount(data)
    } catch (e) {
      Logger.log('Managed policy: could not replace profile ' + accountId + ': ' + e.message)
    }
  }
  for (const accountId of plan.release) {
    try {
      const account = await Account.get(accountId)
      await account.setData(RELEASED_ACCOUNT_DATA)
      Logger.log('Managed policy: profile ' + accountId + ' is no longer managed')
    } catch (e) {
      Logger.log('Managed policy: could not release profile ' + accountId + ': ' + e.message)
    }
  }
  if (plan.deferred.length) {
    Logger.log('Managed policy: postponed changes to syncing profiles ' + plan.deferred.join(', '))
  }
}
