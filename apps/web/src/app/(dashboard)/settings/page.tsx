'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';

interface PlatformConfig {
  dayCutover: string;
  todayMissing: string;
}

interface SchedulerSettings {
  fetch: { enabled: boolean; intervalMs: number };
  refresh: { enabled: boolean; intervalMs: number };
  platforms?: Record<string, PlatformConfig>;
}

interface TelegramFeatures {
  summary: boolean;
  rankings: boolean;
  statusCheck: boolean;
  pinFavorites: boolean;
  scheduledPush: boolean;
  thresholdAlerts: boolean;
}

interface TelegramSettings {
  restricted: boolean;
  sendImage: boolean;
  sendText: boolean;
  allowedChatIds: string[];
  alertChatIds: string[];
  allowedUsernames: string[];
  bot?: { username: string; id: number } | null;
  tokenPreview?: string;
  features?: TelegramFeatures;
  pinnedProfiles?: string[];
  scheduledPush?: { time: string; lastSentDate: string };
  thresholdAlerts?: { depositDropPercent: number; negativeNetFlow: boolean };
}

const SECTION_ICONS = {
  scheduler: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  platform: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
  telegram: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.2 4.6L2.4 11.5c-.5.2-.5.5 0 .7l4.7 1.5 1.8 5.8c.1.4.5.5.8.3l2.6-2.1 5.1 3.7c.4.3.9.1 1-.3L22.5 5.4c.2-.6-.4-1.1-.9-.8z"/><path d="M9.1 13.7l8.4-7.2"/></svg>,
  backup: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
};

export default function SettingsPage() {
  const { user, hasPrivilege } = useAuth();
  const router = useRouter();

  const [scheduler, setScheduler] = useState<SchedulerSettings>({
    fetch: { enabled: false, intervalMs: 300000 },
    refresh: { enabled: false, intervalMs: 300000 },
  });
  const [telegram, setTelegram] = useState<TelegramSettings>({
    restricted: false, sendImage: true, sendText: true,
    allowedChatIds: [], alertChatIds: [], allowedUsernames: [],
  });
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newChatId, setNewChatId] = useState('');
  const [newAlertId, setNewAlertId] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [botToken, setBotToken] = useState('');
  const [botTokenBusy, setBotTokenBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPrivilege('settings.view')) { router.replace('/'); return; }
    Promise.all([
      api.get<{ settings: SchedulerSettings; runtime: any }>('/settings/scheduler')
        .then((res) => res.settings)
        .catch(() => scheduler),
      api.get<TelegramSettings>('/settings/telegram').catch(() => telegram),
    ]).then(([s, t]) => {
      setScheduler(s);
      setTelegram(t);
    }).finally(() => setLoading(false));
  }, [user, router]);

  function showSuccess(msg: string) {
    setSuccess(msg);
    toast(msg, 'success');
    setTimeout(() => setSuccess(''), 3000);
  }

  async function saveScheduler(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.patch('/settings/scheduler', scheduler);
      const res = await api.get<{ settings: SchedulerSettings; runtime: any }>('/settings/scheduler');
      setScheduler(res.settings);
      showSuccess('Scheduler settings saved.');
    } catch (e: any) { setError(e.message); }
  }

  async function saveTelegram() {
    setError('');
    try {
      await api.patch('/settings/telegram', {
        restricted: telegram.restricted,
        sendImage: telegram.sendImage,
        sendText: telegram.sendText,
        features: telegram.features,
        scheduledPush: telegram.scheduledPush,
        thresholdAlerts: telegram.thresholdAlerts,
      });
      const t = await api.get<TelegramSettings>('/settings/telegram');
      setTelegram(t);
      showSuccess('Telegram settings saved.');
    } catch (e: any) { setError(e.message); }
  }

  async function addToList(type: 'chat-ids' | 'alert-chats' | 'usernames', value: string) {
    if (!value.trim()) return;
    setError('');
    try {
      await api.post(`/settings/telegram/${type}`, { value: value.trim() });
      const t = await api.get<TelegramSettings>('/settings/telegram');
      setTelegram(t);
      if (type === 'chat-ids') setNewChatId('');
      else if (type === 'alert-chats') setNewAlertId('');
      else setNewUsername('');
    } catch (e: any) { setError(e.message); }
  }

  async function removeFromList(type: 'chat-ids' | 'alert-chats' | 'usernames', value: string) {
    setError('');
    try {
      await api.delete(`/settings/telegram/${type}/${encodeURIComponent(value)}`);
      const t = await api.get<TelegramSettings>('/settings/telegram');
      setTelegram(t);
    } catch (e: any) { setError(e.message); }
  }

  async function testAlert() {
    setError('');
    try {
      await api.post('/settings/telegram/test-alert', {});
      showSuccess('Test alert sent.');
    } catch (e: any) { setError(e.message); }
  }

  async function updateBotToken() {
    if (!botToken.trim()) return;
    setBotTokenBusy(true);
    setError('');
    try {
      const res = await api.post<{ ok: boolean; username?: string; error?: string }>('/settings/telegram/bot-token', { token: botToken.trim() });
      if (res.ok) {
        showSuccess(res.username ? `Bot connected as @${res.username}` : 'Bot token updated.');
        setBotToken('');
        const t = await api.get<TelegramSettings>('/settings/telegram');
        setTelegram(t);
      } else {
        setError(res.error || 'Failed to update bot token');
      }
    } catch (e: any) { setError(e.message); }
    finally { setBotTokenBusy(false); }
  }

  async function savePlatform(kind: string, config: PlatformConfig) {
    setError('');
    try {
      await api.patch(`/settings/scheduler/platforms/${kind}`, config);
      const res = await api.get<{ settings: SchedulerSettings; runtime: any }>('/settings/scheduler');
      setScheduler(res.settings);
      showSuccess(`${kind} platform config saved.`);
    } catch (e: any) { setError(e.message); }
  }

  if (loading) return (
    <div className="settings-page">
      <div className="space-y-5">
        {[...Array(3)].map((_, i) => <div key={i} className="skeleton skeleton-card" style={{ height: 180 }} />)}
      </div>
    </div>
  );

  const canEdit = hasPrivilege('settings.edit');

  return (
    <div className="settings-page">
      {error && <div className="error-msg mb-4">{error}</div>}
      {success && <div className="success-msg mb-4">{success}</div>}

      <div className="settings-layout">
        {/* ── Scheduler ── */}
        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">{SECTION_ICONS.scheduler}</div>
            <div>
              <h3 className="settings-card-title">Scheduler</h3>
              <p className="settings-card-desc">Automated scraping and session keep-alive</p>
            </div>
            <div className="settings-card-status">
              <span className={`settings-status-badge ${scheduler.fetch.enabled ? 'active' : 'inactive'}`}>
                {scheduler.fetch.enabled ? 'Running' : 'Paused'}
              </span>
            </div>
          </div>

          <form onSubmit={saveScheduler} className="settings-card-body">
            <div className="settings-row">
              <div className="settings-row-label">
                <span>Auto Fetch</span>
                <span className="settings-desc">Periodically scrape all profiles</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={scheduler.fetch.enabled}
                  onChange={(e) => setScheduler({ ...scheduler, fetch: { ...scheduler.fetch, enabled: e.target.checked } })}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            {scheduler.fetch.enabled && (
              <div className="settings-row">
                <div className="settings-row-label"><span>Fetch Interval</span></div>
                <div className="settings-input-group">
                  <input
                    type="number"
                    className="settings-input"
                    min={1}
                    value={Math.round(scheduler.fetch.intervalMs / 60000)}
                    onChange={(e) => setScheduler({ ...scheduler, fetch: { ...scheduler.fetch, intervalMs: Number(e.target.value) * 60000 } })}
                  />
                  <span className="settings-input-suffix">min</span>
                </div>
              </div>
            )}

            <div className="settings-row">
              <div className="settings-row-label">
                <span>Session Refresh</span>
                <span className="settings-desc">Keep browser sessions alive</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={scheduler.refresh.enabled}
                  onChange={(e) => setScheduler({ ...scheduler, refresh: { ...scheduler.refresh, enabled: e.target.checked } })}
                />
                <span className="toggle-slider" />
              </label>
            </div>

            {scheduler.refresh.enabled && (
              <div className="settings-row">
                <div className="settings-row-label"><span>Refresh Interval</span></div>
                <div className="settings-input-group">
                  <input
                    type="number"
                    className="settings-input"
                    min={1}
                    value={Math.round(scheduler.refresh.intervalMs / 60000)}
                    onChange={(e) => setScheduler({ ...scheduler, refresh: { ...scheduler.refresh, intervalMs: Number(e.target.value) * 60000 } })}
                  />
                  <span className="settings-input-suffix">min</span>
                </div>
              </div>
            )}

            {canEdit && (
              <div className="settings-card-actions">
                <button type="submit" className="btn btn-primary">Save Scheduler</button>
              </div>
            )}
          </form>
        </section>

        {/* ── Platform Cutover ── */}
        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">{SECTION_ICONS.platform}</div>
            <div>
              <h3 className="settings-card-title">Platform Cutover</h3>
              <p className="settings-card-desc">Business day boundary (ICT). Daily capture runs 15 min after.</p>
            </div>
          </div>

          <div className="settings-card-body">
            {['cgaming', 'zoomwlb', 'oneopsportal'].map((kind, i, arr) => {
              const cfg = scheduler.platforms?.[kind] || { dayCutover: '11:00', todayMissing: 'calm' };
              return (
                <div key={kind} className={`settings-platform-row ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="settings-platform-name">
                    <span className={`badge badge-${kind.toLowerCase()}`}>{kind.toUpperCase()}</span>
                  </div>
                  <div className="settings-platform-fields">
                    <label className="settings-field-label">
                      <span>Cutover</span>
                      <input
                        type="time"
                        className="settings-input"
                        value={cfg.dayCutover}
                        onChange={(e) => savePlatform(kind, { ...cfg, dayCutover: e.target.value })}
                      />
                    </label>
                    <label className="settings-field-label">
                      <span>If Missing</span>
                      <select
                        className="settings-input"
                        value={cfg.todayMissing}
                        onChange={(e) => savePlatform(kind, { ...cfg, todayMissing: e.target.value })}
                      >
                        <option value="calm">Calm (skip)</option>
                        <option value="fallback">Fallback (nearest)</option>
                      </select>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Telegram Bot ── */}
        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">{SECTION_ICONS.telegram}</div>
            <div>
              <h3 className="settings-card-title">Telegram Bot</h3>
              <p className="settings-card-desc">Notifications, alerts, and remote data access</p>
            </div>
            <div className="settings-card-status">
              <span className={`settings-status-badge ${telegram.bot ? 'active' : 'inactive'}`}>
                {telegram.bot ? 'Connected' : 'Offline'}
              </span>
            </div>
          </div>

          <div className="settings-card-body">
            {/* Bot connection */}
            <div className="settings-bot-banner">
              <span className={`settings-bot-dot ${telegram.bot ? 'online' : 'offline'}`} />
              {telegram.bot ? (
                <span className="settings-bot-info">
                  <strong>@{telegram.bot.username}</strong>
                  <span className="text-muted">ID: {telegram.bot.id}</span>
                  {telegram.tokenPreview && (
                    <span className="text-muted opacity-50">{telegram.tokenPreview}</span>
                  )}
                </span>
              ) : (
                <span className="text-muted">No bot connected</span>
              )}
            </div>

            {canEdit && (
              <div className="settings-token-row">
                <input
                  placeholder="Paste new bot token..."
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), updateBotToken())}
                />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={botTokenBusy || !botToken.trim()}
                  onClick={updateBotToken}
                >
                  {botTokenBusy ? 'Connecting...' : 'Update Bot'}
                </button>
              </div>
            )}

            {/* Toggles section */}
            <div className="settings-subsection">
              <h4 className="settings-subsection-title">Behavior</h4>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>Restricted Mode</span>
                  <span className="settings-desc">Only listed chat IDs / usernames can interact</span>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={telegram.restricted} onChange={(e) => setTelegram({ ...telegram, restricted: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <span>Send Image</span>
                  <span className="settings-desc">Send PNG card with scrape results</span>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={telegram.sendImage} onChange={(e) => setTelegram({ ...telegram, sendImage: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="settings-row">
                <div className="settings-row-label">
                  <span>Send Text</span>
                  <span className="settings-desc">Send formatted text message with results</span>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={telegram.sendText} onChange={(e) => setTelegram({ ...telegram, sendText: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              {canEdit && (
                <div className="settings-card-actions">
                  <button type="button" className="btn btn-primary" onClick={saveTelegram}>Save Telegram</button>
                  <button type="button" className="btn btn-ghost" onClick={testAlert}>Test Alert</button>
                </div>
              )}
            </div>

            {/* Bot Features section */}
            <div className="settings-subsection">
              <h4 className="settings-subsection-title">Bot Features</h4>

              {([
                { key: 'summary' as const, label: 'Summary', desc: 'All-profiles consolidated totals' },
                { key: 'rankings' as const, label: 'Rankings', desc: 'Top/bottom profiles by deposits' },
                { key: 'statusCheck' as const, label: 'Status Check', desc: 'Session status overview' },
                { key: 'pinFavorites' as const, label: 'Pin Favorites', desc: 'Star key profiles to show first' },
                { key: 'scheduledPush' as const, label: 'Scheduled Push', desc: 'Auto-send daily summary' },
                { key: 'thresholdAlerts' as const, label: 'Threshold Alerts', desc: 'Alert on metric drops' },
              ] as const).map(({ key, label, desc }) => (
                <div key={key} className="settings-row">
                  <div className="settings-row-label">
                    <span>{label}</span>
                    <span className="settings-desc">{desc}</span>
                  </div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={telegram.features?.[key] ?? false}
                      onChange={(e) => setTelegram({
                        ...telegram,
                        features: { ...telegram.features!, [key]: e.target.checked },
                      })}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              ))}

              {telegram.features?.scheduledPush && (
                <div className="settings-row">
                  <div className="settings-row-label">
                    <span>Push Time (ICT)</span>
                    <span className="settings-desc">Daily summary sent at this time</span>
                  </div>
                  <input
                    type="time"
                    className="settings-input"
                    value={telegram.scheduledPush?.time || '11:30'}
                    onChange={(e) => setTelegram({
                      ...telegram,
                      scheduledPush: { ...telegram.scheduledPush!, time: e.target.value },
                    })}
                  />
                </div>
              )}

              {telegram.features?.thresholdAlerts && (
                <>
                  <div className="settings-row">
                    <div className="settings-row-label">
                      <span>Deposit Drop %</span>
                      <span className="settings-desc">Alert when deposits drop by this percentage</span>
                    </div>
                    <div className="settings-input-group">
                      <input
                        type="number"
                        className="settings-input"
                        min={5}
                        max={100}
                        value={telegram.thresholdAlerts?.depositDropPercent ?? 30}
                        onChange={(e) => setTelegram({
                          ...telegram,
                          thresholdAlerts: { ...telegram.thresholdAlerts!, depositDropPercent: Number(e.target.value) },
                        })}
                      />
                      <span className="settings-input-suffix">%</span>
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-label">
                      <span>Negative Net Flow</span>
                      <span className="settings-desc">Alert when net flow goes negative</span>
                    </div>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={telegram.thresholdAlerts?.negativeNetFlow ?? true}
                        onChange={(e) => setTelegram({
                          ...telegram,
                          thresholdAlerts: { ...telegram.thresholdAlerts!, negativeNetFlow: e.target.checked },
                        })}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </>
              )}

              {canEdit && (
                <div className="settings-card-actions">
                  <button type="button" className="btn btn-primary" onClick={saveTelegram}>Save Telegram</button>
                  <button type="button" className="btn btn-ghost" onClick={testAlert}>Test Alert</button>
                </div>
              )}
            </div>

            {/* Access control section */}
            <div className="settings-subsection">
              <h4 className="settings-subsection-title">Access Control</h4>

              <div className="settings-list-group">
                <div className="settings-list-header" onClick={() => setActiveSection(activeSection === 'chatIds' ? null : 'chatIds')}>
                  <div>
                    <span className="settings-list-title">Allowed Chat IDs</span>
                    <span className="settings-list-count">{telegram.allowedChatIds.length}</span>
                  </div>
                  <span className={`settings-list-chevron ${activeSection === 'chatIds' ? 'open' : ''}`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                  </span>
                </div>
                {activeSection === 'chatIds' && (
                  <div className="settings-list-body">
                    <div className="list-items">
                      {telegram.allowedChatIds.map((id) => (
                        <div key={id} className="list-chip">
                          <span>{id}</span>
                          {canEdit && <button className="chip-remove" onClick={() => removeFromList('chat-ids', id)}>×</button>}
                        </div>
                      ))}
                      {telegram.allowedChatIds.length === 0 && <span className="text-muted text-xs">No chat IDs added</span>}
                    </div>
                    {canEdit && (
                      <div className="list-add">
                        <input placeholder="Chat ID" value={newChatId} onChange={(e) => setNewChatId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addToList('chat-ids', newChatId))} />
                        <button className="btn btn-sm btn-primary" onClick={() => addToList('chat-ids', newChatId)}>Add</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="settings-list-group">
                <div className="settings-list-header" onClick={() => setActiveSection(activeSection === 'alertIds' ? null : 'alertIds')}>
                  <div>
                    <span className="settings-list-title">Alert Chat IDs</span>
                    <span className="settings-list-count">{telegram.alertChatIds.length}</span>
                  </div>
                  <span className={`settings-list-chevron ${activeSection === 'alertIds' ? 'open' : ''}`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                  </span>
                </div>
                {activeSection === 'alertIds' && (
                  <div className="settings-list-body">
                    <div className="list-items">
                      {telegram.alertChatIds.map((id) => (
                        <div key={id} className="list-chip">
                          <span>{id}</span>
                          {canEdit && <button className="chip-remove" onClick={() => removeFromList('alert-chats', id)}>×</button>}
                        </div>
                      ))}
                      {telegram.alertChatIds.length === 0 && <span className="text-muted text-xs">No alert chat IDs added</span>}
                    </div>
                    {canEdit && (
                      <div className="list-add">
                        <input placeholder="Alert Chat ID" value={newAlertId} onChange={(e) => setNewAlertId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addToList('alert-chats', newAlertId))} />
                        <button className="btn btn-sm btn-primary" onClick={() => addToList('alert-chats', newAlertId)}>Add</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="settings-list-group">
                <div className="settings-list-header" onClick={() => setActiveSection(activeSection === 'usernames' ? null : 'usernames')}>
                  <div>
                    <span className="settings-list-title">Allowed Usernames</span>
                    <span className="settings-list-count">{telegram.allowedUsernames.length}</span>
                  </div>
                  <span className={`settings-list-chevron ${activeSection === 'usernames' ? 'open' : ''}`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                  </span>
                </div>
                {activeSection === 'usernames' && (
                  <div className="settings-list-body">
                    <div className="list-items">
                      {telegram.allowedUsernames.map((u) => (
                        <div key={u} className="list-chip">
                          <span>@{u}</span>
                          {canEdit && <button className="chip-remove" onClick={() => removeFromList('usernames', u)}>×</button>}
                        </div>
                      ))}
                      {telegram.allowedUsernames.length === 0 && <span className="text-muted text-xs">No usernames added</span>}
                    </div>
                    {canEdit && (
                      <div className="list-add">
                        <input placeholder="Username (without @)" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addToList('usernames', newUsername))} />
                        <button className="btn btn-sm btn-primary" onClick={() => addToList('usernames', newUsername)}>Add</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Backup ── */}
        <section className="settings-card">
          <div className="settings-card-header">
            <div className="settings-card-icon">{SECTION_ICONS.backup}</div>
            <div>
              <h3 className="settings-card-title">Backup & Restore</h3>
              <p className="settings-card-desc">Export or restore your scraper data</p>
            </div>
          </div>

          <div className="settings-card-body">
            <div className="settings-backup-actions">
              <button
                className="settings-backup-btn"
                onClick={async () => {
                  setError('');
                  try {
                    const data = await api.get('/backup');
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `scraper-backup-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (err: any) {
                    setError(err.message || 'Export failed');
                  }
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <div>
                  <div className="settings-backup-label">Download Backup</div>
                  <div className="settings-backup-hint">Export all data as JSON</div>
                </div>
              </button>

              <label className="settings-backup-btn restore">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <div>
                  <div className="settings-backup-label">Restore from File</div>
                  <div className="settings-backup-hint">Import a backup JSON file</div>
                </div>
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!confirm('This will REPLACE all data. A pre-restore snapshot will be saved. Continue?')) return;
                    setError('');
                    try {
                      const text = await file.text();
                      const data = JSON.parse(text);
                      await api.post('/backup/restore', data);
                      showSuccess('Backup restored successfully.');
                    } catch (err: any) {
                      setError(err.message || 'Restore failed');
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
