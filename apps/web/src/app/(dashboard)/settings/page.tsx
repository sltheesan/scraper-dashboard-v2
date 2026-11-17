'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/auth-context';

interface PlatformConfig {
  dayCutover: string;
  todayMissing: string;
}

interface SchedulerSettings {
  fetch: { enabled: boolean; intervalMs: number };
  refresh: { enabled: boolean; intervalMs: number };
  platforms?: Record<string, PlatformConfig>;
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
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newChatId, setNewChatId] = useState('');
  const [newAlertId, setNewAlertId] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [botToken, setBotToken] = useState('');
  const [botTokenBusy, setBotTokenBusy] = useState(false);

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

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="settings-page">
      {error && <div className="error-msg mb-4">{error}</div>}
      {success && <div className="success-msg mb-4">{success}</div>}

      <div className="settings-grid">
        {/* Scheduler */}
        <section className="card settings-section">
          <h3>Scheduler</h3>
          <form onSubmit={saveScheduler}>
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

            <div className="settings-row">
              <div className="settings-row-label"><span>Fetch Interval (min)</span></div>
              <input
                type="number"
                className="settings-input"
                min={1}
                value={Math.round(scheduler.fetch.intervalMs / 60000)}
                onChange={(e) => setScheduler({ ...scheduler, fetch: { ...scheduler.fetch, intervalMs: Number(e.target.value) * 60000 } })}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-label">
                <span>Session Refresh</span>
                <span className="settings-desc">Keep-alive for browser sessions</span>
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

            <div className="settings-row">
              <div className="settings-row-label"><span>Refresh Interval (min)</span></div>
              <input
                type="number"
                className="settings-input"
                min={1}
                value={Math.round(scheduler.refresh.intervalMs / 60000)}
                onChange={(e) => setScheduler({ ...scheduler, refresh: { ...scheduler.refresh, intervalMs: Number(e.target.value) * 60000 } })}
              />
            </div>

            <div className="form-actions mt-3">
              <button type="submit" className="btn btn-primary">Save Scheduler</button>
            </div>
          </form>
        </section>

        {/* Platform Cutover */}
        <section className="card settings-section">
          <h3>Platform Cutover</h3>
          <p className="text-muted text-xs mb-3">
            Business day boundary (ICT). Daily capture runs 15 min after.
          </p>
          {['cgaming', 'zoomwlb'].map((kind) => {
            const cfg = scheduler.platforms?.[kind] || { dayCutover: '11:00', todayMissing: 'calm' };
            return (
              <div key={kind} className="mb-4">
                <div className="font-semibold text-[13px] uppercase mb-2">
                  {kind}
                </div>
                <div className="flex gap-3 items-center flex-wrap">
                  <label className="text-[13px] flex items-center gap-1.5">
                    Cutover
                    <input
                      type="time"
                      className="settings-input w-[110px]"
                      value={cfg.dayCutover}
                      onChange={(e) => savePlatform(kind, { ...cfg, dayCutover: e.target.value })}
                    />
                  </label>
                  <label className="text-[13px] flex items-center gap-1.5">
                    Today Missing
                    <select
                      className="settings-input w-auto"
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
        </section>

        {/* Telegram Bot */}
        <section className="card settings-section settings-full">
          <h3>Telegram Bot</h3>

          <div className="settings-bot-status">
            <span className={`settings-bot-dot ${telegram.bot ? 'online' : 'offline'}`} />
            {telegram.bot ? (
              <span>
                <strong>@{telegram.bot.username}</strong>
                <span className="text-muted ml-1.5">ID: {telegram.bot.id}</span>
                {telegram.tokenPreview && (
                  <span className="text-muted ml-2.5 opacity-60">
                    {telegram.tokenPreview}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted">
                No bot connected
                {telegram.tokenPreview && (
                  <span className="ml-2.5 opacity-60">{telegram.tokenPreview}</span>
                )}
              </span>
            )}
          </div>

          <div className="settings-token-row mb-4">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Toggles */}
            <div>
              <div className="settings-row">
                <div className="settings-row-label">
                  <span>Restricted Mode</span>
                  <span className="settings-desc">Only listed chat IDs / usernames</span>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={telegram.restricted} onChange={(e) => setTelegram({ ...telegram, restricted: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="settings-row">
                <div className="settings-row-label"><span>Send Image</span></div>
                <label className="toggle">
                  <input type="checkbox" checked={telegram.sendImage} onChange={(e) => setTelegram({ ...telegram, sendImage: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="settings-row">
                <div className="settings-row-label"><span>Send Text</span></div>
                <label className="toggle">
                  <input type="checkbox" checked={telegram.sendText} onChange={(e) => setTelegram({ ...telegram, sendText: e.target.checked })} />
                  <span className="toggle-slider" />
                </label>
              </div>

              <div className="form-actions mt-3">
                <button type="button" className="btn btn-primary" onClick={saveTelegram}>Save Telegram</button>
                <button type="button" className="btn btn-ghost" onClick={testAlert}>Test Alert</button>
              </div>
            </div>

            {/* Lists */}
            <div>
              <div className="list-section !mt-0 !pt-0 !border-t-0">
                <h4>Allowed Chat IDs</h4>
                <div className="list-items">
                  {telegram.allowedChatIds.map((id) => (
                    <div key={id} className="list-chip">
                      <span>{id}</span>
                      <button className="chip-remove" onClick={() => removeFromList('chat-ids', id)}>×</button>
                    </div>
                  ))}
                </div>
                <div className="list-add">
                  <input placeholder="Chat ID" value={newChatId} onChange={(e) => setNewChatId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addToList('chat-ids', newChatId))} />
                  <button className="btn btn-sm btn-primary" onClick={() => addToList('chat-ids', newChatId)}>Add</button>
                </div>
              </div>

              <div className="list-section">
                <h4>Alert Chat IDs</h4>
                <div className="list-items">
                  {telegram.alertChatIds.map((id) => (
                    <div key={id} className="list-chip">
                      <span>{id}</span>
                      <button className="chip-remove" onClick={() => removeFromList('alert-chats', id)}>×</button>
                    </div>
                  ))}
                </div>
                <div className="list-add">
                  <input placeholder="Alert Chat ID" value={newAlertId} onChange={(e) => setNewAlertId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addToList('alert-chats', newAlertId))} />
                  <button className="btn btn-sm btn-primary" onClick={() => addToList('alert-chats', newAlertId)}>Add</button>
                </div>
              </div>

              <div className="list-section">
                <h4>Allowed Usernames</h4>
                <div className="list-items">
                  {telegram.allowedUsernames.map((u) => (
                    <div key={u} className="list-chip">
                      <span>@{u}</span>
                      <button className="chip-remove" onClick={() => removeFromList('usernames', u)}>×</button>
                    </div>
                  ))}
                </div>
                <div className="list-add">
                  <input placeholder="Username (without @)" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addToList('usernames', newUsername))} />
                  <button className="btn btn-sm btn-primary" onClick={() => addToList('usernames', newUsername)}>Add</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Backup */}
        <section className="card settings-section settings-full">
          <h3>Backup &amp; Restore</h3>
          <div className="flex gap-3 items-center">
            <button
              className="btn btn-primary"
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
              Download Backup
            </button>
            <label className="btn btn-ghost cursor-pointer">
              Restore from File
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
        </section>
      </div>
    </div>
  );
}
