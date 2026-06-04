import { colorForUser } from '../lib/presence-service';
import type { PresenceUser } from '../lib/presence-service';

export interface SimUser {
  userId: string;
  email: string;
  displayName: string;
  color: string;
}

const RAW_USERS: { name: string; email: string; uuid: string }[] = [
  { name: 'Sarah Chen', email: 'sarah.chen@studio.com', uuid: 'a1b2c3d4-1111-4000-a000-000000000001' },
  { name: 'Marcus Rivera', email: 'marcus.rivera@studio.com', uuid: 'a1b2c3d4-2222-4000-a000-000000000002' },
  { name: 'Yuki Tanaka', email: 'yuki.tanaka@studio.com', uuid: 'a1b2c3d4-3333-4000-a000-000000000003' },
  { name: 'Priya Sharma', email: 'priya.sharma@studio.com', uuid: 'a1b2c3d4-4444-4000-a000-000000000004' },
  { name: "James O'Brien", email: 'james.obrien@studio.com', uuid: 'a1b2c3d4-5555-4000-a000-000000000005' },
  { name: 'Amara Okafor', email: 'amara.okafor@studio.com', uuid: 'a1b2c3d4-6666-4000-a000-000000000006' },
  { name: 'Liam Petrov', email: 'liam.petrov@studio.com', uuid: 'a1b2c3d4-7777-4000-a000-000000000007' },
  { name: 'Sofia Morales', email: 'sofia.morales@studio.com', uuid: 'a1b2c3d4-8888-4000-a000-000000000008' },
  { name: 'Wei Zhang', email: 'wei.zhang@studio.com', uuid: 'a1b2c3d4-9999-4000-a000-000000000009' },
  { name: 'Elena Vasquez', email: 'elena.vasquez@studio.com', uuid: 'a1b2c3d4-aaaa-4000-a000-000000000010' },
  { name: 'David Kim', email: 'david.kim@studio.com', uuid: 'a1b2c3d4-bbbb-4000-a000-000000000011' },
  { name: 'Fatima Al-Hassan', email: 'fatima.alhassan@studio.com', uuid: 'a1b2c3d4-cccc-4000-a000-000000000012' },
  { name: 'Noah Williams', email: 'noah.williams@studio.com', uuid: 'a1b2c3d4-dddd-4000-a000-000000000013' },
  { name: 'Aisha Patel', email: 'aisha.patel@studio.com', uuid: 'a1b2c3d4-eeee-4000-a000-000000000014' },
  { name: 'Lucas Bergström', email: 'lucas.bergstrom@studio.com', uuid: 'a1b2c3d4-ffff-4000-a000-000000000015' },
  { name: 'Maya Johnson', email: 'maya.johnson@studio.com', uuid: 'a1b2c3d4-1010-4000-a000-000000000016' },
  { name: 'Ravi Gupta', email: 'ravi.gupta@studio.com', uuid: 'a1b2c3d4-2020-4000-a000-000000000017' },
  { name: 'Chloe Dubois', email: 'chloe.dubois@studio.com', uuid: 'a1b2c3d4-3030-4000-a000-000000000018' },
  { name: 'Tomás García', email: 'tomas.garcia@studio.com', uuid: 'a1b2c3d4-4040-4000-a000-000000000019' },
  { name: 'Ingrid Nylund', email: 'ingrid.nylund@studio.com', uuid: 'a1b2c3d4-5050-4000-a000-000000000020' },
];

export const SIM_USERS: SimUser[] = RAW_USERS.map((u) => ({
  userId: u.uuid,
  email: u.email,
  displayName: u.name,
  color: colorForUser(u.uuid),
}));

/** Build a full PresenceUser state object for tracking on a channel. */
export function buildPresenceState(
  user: SimUser,
  currentCommitId: string | null = null,
  statusMessage: string = '',
): PresenceUser {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    color: user.color,
    currentCommitId,
    statusMessage,
    joinedAt: Date.now(),
  };
}
