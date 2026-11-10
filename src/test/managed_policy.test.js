import { expect } from './utils'
import { managedAccountData, parseManagedPolicy, planManagedAccounts } from '../lib/ManagedPolicy'

const FOLDERS = { toolbar: '1', other: '2', root: '0' }
const resolve = (preset) => FOLDERS[preset] || null

const ENTRY = {
  id: 'company-bookmarks',
  type: 'webdav',
  url: 'https://dav.example.org/',
  bookmark_file: 'bookmarks.xbel',
  bookmark_file_type: 'xbel',
  includeCredentials: true,
  localRootPreset: 'toolbar',
}

function existing(id, entry = ENTRY, extra = {}) {
  const policy = parseManagedPolicy({ accounts: [entry] })
  return {
    id,
    data: { ...managedAccountData(policy.accounts[0], resolve(policy.accounts[0].localRootPreset)), ...extra },
  }
}

describe('ManagedPolicy', function() {
  describe('parseManagedPolicy', function() {
    it('returns null without a policy', function() {
      expect(parseManagedPolicy(undefined)).to.equal(null)
      expect(parseManagedPolicy({})).to.equal(null)
      expect(parseManagedPolicy({ somethingElse: true })).to.equal(null)
    })

    it('tells an empty list from no policy', function() {
      expect(parseManagedPolicy({ accounts: [] })).to.deep.equal({ accounts: [] })
    })

    it('reads an entry', function() {
      const policy = parseManagedPolicy({ accounts: [{ ...ENTRY, lockSettings: true, syncInterval: 30 }] })
      expect(policy.accounts).to.have.length(1)
      const [account] = policy.accounts
      expect(account.id).to.equal('company-bookmarks')
      expect(account.type).to.equal('webdav')
      expect(account.localRootPreset).to.equal('toolbar')
      expect(account.lockSettings).to.equal(true)
      expect(account.settings).to.deep.equal({
        url: 'https://dav.example.org/',
        bookmark_file: 'bookmarks.xbel',
        bookmark_file_type: 'xbel',
        includeCredentials: true,
        syncInterval: 30,
      })
    })

    it('defaults to webdav on the bookmarks bar, unlocked', function() {
      const [account] = parseManagedPolicy({ accounts: [{ id: 'a', url: 'https://dav.example.org/' }] }).accounts
      expect(account.type).to.equal('webdav')
      expect(account.localRootPreset).to.equal('toolbar')
      expect(account.lockSettings).to.equal(false)
    })

    it('skips invalid entries and duplicate ids', function() {
      const log = []
      const policy = parseManagedPolicy({
        accounts: [
          { url: 'https://dav.example.org/' },
          { id: 'b', type: 'google-drive', url: 'https://dav.example.org/' },
          { id: 'c' },
          { id: 'd', url: 'https://dav.example.org/', localRootPreset: 'desktop' },
          { id: 'e', url: 'https://dav.example.org/' },
          { id: 'e', url: 'https://other.example.org/' },
          'not json',
        ],
      }, (m) => log.push(m))
      expect(policy.accounts.map(a => a.id)).to.deep.equal(['e'])
      expect(policy.accounts[0].settings.url).to.equal('https://dav.example.org/')
      expect(log).to.have.length(6)
    })

    it('drops settings of the wrong type and never takes secrets', function() {
      const [account] = parseManagedPolicy({
        accounts: [{
          ...ENTRY,
          includeCredentials: 'yes',
          bookmark_file_type: 'json',
          strategy: 'whatever',
          syncInterval: 0,
          password: 'hunter2',
          passphrase: 'secret',
          unknownSetting: 1,
        }],
      }).accounts
      expect(account.settings).to.not.have.property('includeCredentials')
      expect(account.settings).to.not.have.property('bookmark_file_type')
      expect(account.settings).to.not.have.property('strategy')
      expect(account.settings).to.not.have.property('syncInterval')
      expect(account.settings).to.not.have.property('password')
      expect(account.settings).to.not.have.property('passphrase')
      expect(account.settings).to.not.have.property('unknownSetting')
    })

    it('understands what registry-backed policies turn values into', function() {
      // Lists as objects of numbered keys, booleans as DWORDs, JSON strings
      const policy = parseManagedPolicy({
        accounts: {
          2: JSON.stringify({ id: 'second', url: 'https://dav.example.org/b/' }),
          1: { id: 'first', url: 'https://dav.example.org/a/', includeCredentials: 1, lockSettings: 0, syncInterval: '20' },
        },
      })
      expect(policy.accounts.map(a => a.id)).to.deep.equal(['first', 'second'])
      expect(policy.accounts[0].settings.includeCredentials).to.equal(true)
      expect(policy.accounts[0].settings.syncInterval).to.equal(20)
      expect(policy.accounts[0].lockSettings).to.equal(false)

      expect(parseManagedPolicy({ accounts: JSON.stringify([ENTRY]) }).accounts).to.have.length(1)
    })
  })

  describe('planManagedAccounts', function() {
    it('creates a profile for a new entry', function() {
      const policy = parseManagedPolicy({ accounts: [{ ...ENTRY, lockSettings: true }] })
      const plan = planManagedAccounts(policy, [], resolve)
      expect(plan.create).to.have.length(1)
      const [data] = plan.create
      expect(data.managedId).to.equal('company-bookmarks')
      expect(data.managedLocked).to.equal(true)
      expect(data.localRoot).to.equal('1')
      expect(data.type).to.equal('webdav')
      expect(data.includeCredentials).to.equal(true)
      // Syncs by itself
      expect(data.enabled).to.equal(true)
      expect(data.syncIntervalEnabled).to.equal(true)
      expect(data.syncOnStartupEnabled).to.equal(true)
      expect(data.managedKeys).to.include.members(['url', 'localRoot', 'type'])
      expect(data.managedKeys).to.not.include('enabled')
    })

    it('lets the policy override the defaults of a new profile', function() {
      const policy = parseManagedPolicy({ accounts: [{ ...ENTRY, syncOnStartupEnabled: false }] })
      const [data] = planManagedAccounts(policy, [], resolve).create
      expect(data.syncOnStartupEnabled).to.equal(false)
    })

    it('leaves a profile alone that already matches', function() {
      const policy = parseManagedPolicy({ accounts: [ENTRY] })
      const plan = planManagedAccounts(policy, [existing('acc1', ENTRY, { enabled: false, label: 'Mine' })], resolve)
      expect(plan).to.deep.equal({ create: [], update: [], replace: [], release: [], deferred: [] })
    })

    it('does not touch profiles it did not create', function() {
      const policy = parseManagedPolicy({ accounts: [] })
      const plan = planManagedAccounts(policy, [{ id: 'own', data: { type: 'webdav', url: 'https://dav.example.org/' } }], resolve)
      expect(plan).to.deep.equal({ create: [], update: [], replace: [], release: [], deferred: [] })
    })

    it('writes only what changed, and starts over when what is synced changed', function() {
      let policy = parseManagedPolicy({ accounts: [{ ...ENTRY, label: 'Company' }] })
      let plan = planManagedAccounts(policy, [existing('acc1')], resolve)
      expect(plan.update).to.have.length(1)
      expect(plan.update[0].accountId).to.equal('acc1')
      expect(plan.update[0].reinitialize).to.equal(false)
      expect(plan.update[0].data.label).to.equal('Company')
      expect(plan.update[0].data).to.not.have.property('url')

      policy = parseManagedPolicy({ accounts: [{ ...ENTRY, url: 'https://dav.example.org/new/' }] })
      plan = planManagedAccounts(policy, [existing('acc1')], resolve)
      expect(plan.update[0].reinitialize).to.equal(true)
      expect(plan.update[0].data.url).to.equal('https://dav.example.org/new/')

      policy = parseManagedPolicy({ accounts: [{ ...ENTRY, localRootPreset: 'other' }] })
      plan = planManagedAccounts(policy, [existing('acc1')], resolve)
      expect(plan.update[0].reinitialize).to.equal(true)
      expect(plan.update[0].data.localRoot).to.equal('2')
    })

    it('restores settings the user changed', function() {
      const policy = parseManagedPolicy({ accounts: [ENTRY] })
      const plan = planManagedAccounts(policy, [existing('acc1', ENTRY, { includeCredentials: false })], resolve)
      expect(plan.update[0].data).to.deep.equal({ includeCredentials: true })
    })

    it('waits for a running sync before changing what is synced', function() {
      const policy = parseManagedPolicy({ accounts: [{ ...ENTRY, url: 'https://dav.example.org/new/' }] })
      const plan = planManagedAccounts(policy, [{ ...existing('acc1'), syncing: true }], resolve)
      expect(plan.update).to.have.length(0)
      expect(plan.deferred).to.deep.equal(['acc1'])
    })

    it('replaces a profile whose type changed', function() {
      const policy = parseManagedPolicy({ accounts: [{ ...ENTRY, type: 'nextcloud-bookmarks' }] })
      const plan = planManagedAccounts(policy, [existing('acc1')], resolve)
      expect(plan.replace).to.have.length(1)
      expect(plan.replace[0].accountId).to.equal('acc1')
      expect(plan.replace[0].data.type).to.equal('nextcloud-bookmarks')
      expect(plan.create).to.have.length(0)
    })

    it('releases profiles no longer in the policy', function() {
      const policy = parseManagedPolicy({ accounts: [] })
      const plan = planManagedAccounts(policy, [existing('acc1')], resolve)
      expect(plan.release).to.deep.equal(['acc1'])
    })

    it('skips an entry whose folder this browser does not have, and keeps its profile', function() {
      const policy = parseManagedPolicy({ accounts: [{ ...ENTRY, localRootPreset: 'menu' }] })
      const plan = planManagedAccounts(policy, [existing('acc1')], resolve)
      expect(plan).to.deep.equal({ create: [], update: [], replace: [], release: [], deferred: [] })
    })

    it('handles several entries independently', function() {
      const second = { ...ENTRY, id: 'second', url: 'https://dav.example.org/b/', localRootPreset: 'other' }
      const policy = parseManagedPolicy({ accounts: [ENTRY, second] })
      const plan = planManagedAccounts(policy, [existing('acc1')], resolve)
      expect(plan.create.map(d => d.managedId)).to.deep.equal(['second'])
      expect(plan.update).to.have.length(0)
    })
  })
})
