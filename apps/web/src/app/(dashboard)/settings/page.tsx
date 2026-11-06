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
}

export default function SettingsPage() {
  const { user } = useAuth();
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

  useEffect(() => {
    if (user?.role !== 'ADMIN') { router.replace('/'); return; }
    Promise.all([
      api.get<{ settings: SchedulerSettings; runtime: any }>('/settings/scheduler').catch(() => ({ settings: scheduler, runtime: null })),
      api.get<TelegramSettings>('/settings/telegram').catch(() => telegram),
    ]).then(([sRes, t]) => {
      setScheduler(sRes.settings);
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
      const saved = await api.patch<SchedulerSettings>('/settings/scheduler', scheduler);
      setScheduler(saved);
      showSuccess('Scheduler settings saved.');
    } catch (e: any) { setError(e.message); }
  }

  async function saveTelegram() {
    setError('');
    try {
      const saved = await api.patch<TelegramSettings>('/settings/telegram', {
        restricted: telegram.restricted,
        sendImage: telegram.sendImage,
        sendText: telegram.sendText,
      });
      setTelegram((prev) => ({ ...prev, ...saved }));
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

  async function savePlatform(kind: string, config: PlatformConfig) {
    setError('');
    try {
      await api.patch(`/settings/scheduler/platforms/${kind}`, config);
      const s = await api.get<SchedulerSettings>('/settings/scheduler');
      setScheduler(s);
      showSuccess(`${kind} platform config saved.`);
    } catch (e: any) { setError(e.message); }
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="settings-page">
      {error && <div className="error-msg" style={{ marginBottom: 16 }}>{error}</div>}
      {success && <div className="success-msg" style={{ marginBottom: 16 }}>{success}</div>}

      <section className="card settings-section">
        <h3>Scheduler Settings</h3>
        <form onSubmit={saveScheduler}>
          <div className="settings-row">
            <div className="settings-row-label">
              <span>Fetch Enabled</span>
              <span className="settings-desc">Periodically fetch scrape data from all profiles</span>
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
            <div className="settings-row-label">
              <span>Fetch Interval (minutes)</span>
            </div>
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
              <span>Refresh Enabled</span>
              <span className="settings-desc">Navigate-only keep-alive for browser sessions</span>
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
            <div className="settings-row-label">
              <span>Refresh Interval (minutes)</span>
            </div>
            <input
              type="number"
              className="settings-input"
              min={1}
              value={Math.round(scheduler.refresh.intervalMs / 60000)}
              onChange={(e) => setScheduler({ ...scheduler, refresh: { ...scheduler.refresh, intervalMs: Number(e.target.value) * 60000 } })}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Save Scheduler</button>
          </div>
        </form>
      </section>

      <section className="card settings-section" style={{ marginTop: 24 }}>
        <h3>Platform Cutover</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          Business day cutover time (ICT) for each platform. Daily capture runs at this time + 15 min.
        </p>
        {['cgaming', 'zoomwlb'].map((kind) => {
          const cfg = scheduler.platforms?.[kind] || { dayCutover: '11:00', todayMissing: 'calm' };
          return (
            <div key={kind} className="settings-row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <div className="settings-row-label" style={{ minWidth: 120 }}>
                <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{kind}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13 }}>
                  Cutover
                  <input
                    type="time"
                    className="settings-input"
                    style={{ width: 110, marginLeft: 6 }}
                    value={cfg.dayCutover}
                    onChange={(e) => savePlatform(kind, { ...cfg, dayCutover: e.target.value })}
                  />
                </label>
                <label style={{ fontSize: 13 }}>
                  Today Missing
                  <select
                    className="settings-input"
                    style={{ marginLeft: 6 }}
                    value={cfg.todayMissing}
                    onChange={(e) => savePlatform(kind, { ...cfg, todayMissing: e.target.value })}
                  >
                    <option value="calm">Calm (skip)</option>
                    <option value="fallback">Fallback (nearest date)</option>
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card settings-section" style={{ marginTop: 24 }}>
        <h3>Telegram Settings</h3>

        {telegram.bot && (
          <div style={{ padding: '10px 14px', background: 'var(--surface)', borderRadius: 8, marginBottom: 16, fontSize: 13, color: 'var(--muted)' }}>
            Bot online: <strong style={{ color: 'var(--fg)' }}>@{telegram.bot.username}</strong> (ID: {telegram.bot.id})
          </div>
        )}

        <div className="settings-row">
          <div className="settings-row-label">
            <span>Restricted Mode</span>
            <span className="settings-desc">Only allow listed chat IDs and usernames</span>
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

        <div className="form-actions" style={{ marginBottom: 20 }}>
          <button type="button" className="btn btn-primary" onClick={saveTelegram}>Save Telegram</button>
        </div>

        <div className="list-section">
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

        <div className="form-actions" style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-ghost" onClick={testAlert}>Send Test Alert</button>
        </div>
      </section>

      <section className="card settings-section" style={{ marginTop: 24 }}>
        <h3>Backup &amp; Restore</h3>
        <div className="detail-actions">
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
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            Restore from File
            <input
              type="file"
              accept=".json"
              style={{ display: 'none' }}
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
  );
}
