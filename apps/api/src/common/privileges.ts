export const ALL_PRIVILEGES = [
  'profiles.view',
  'profiles.create',
  'profiles.edit',
  'profiles.delete',
  'profiles.login',
  'profiles.fetch',
  'credentials.view',
  'credentials.edit',
  'settings.view',
  'settings.edit',
  'users.view',
  'users.create',
  'users.edit',
  'users.delete',
  'groups.manage',
  'activity.view',
  'logs.view',
  'backup.export',
  'backup.restore',
  'telegram.use',
  'reports.view',
] as const;

export type Privilege = (typeof ALL_PRIVILEGES)[number];

export const PRIVILEGE_CATEGORIES: Record<string, { label: string; privileges: Privilege[] }> = {
  profiles: {
    label: 'Profiles',
    privileges: ['profiles.view', 'profiles.create', 'profiles.edit', 'profiles.delete', 'profiles.login', 'profiles.fetch'],
  },
  credentials: {
    label: 'Credentials',
    privileges: ['credentials.view', 'credentials.edit'],
  },
  settings: {
    label: 'Settings',
    privileges: ['settings.view', 'settings.edit'],
  },
  users: {
    label: 'Users',
    privileges: ['users.view', 'users.create', 'users.edit', 'users.delete'],
  },
  groups: {
    label: 'User Groups',
    privileges: ['groups.manage'],
  },
  activity: {
    label: 'Activity & Logs',
    privileges: ['activity.view', 'logs.view'],
  },
  backup: {
    label: 'Backup',
    privileges: ['backup.export', 'backup.restore'],
  },
  telegram: {
    label: 'Telegram',
    privileges: ['telegram.use'],
  },
  reports: {
    label: 'Reports',
    privileges: ['reports.view'],
  },
};

export const SUPER_ADMIN_EMAIL = 'sltheesan@gmail.com';
