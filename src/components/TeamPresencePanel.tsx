import { useState } from 'react';
import { toast } from 'sonner';
import { usePresence } from '@/contexts/PresenceContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users } from 'lucide-react';

export function TeamPresencePanel() {
  const { onlineUsers, myUserId, updatePresenceStatus } = usePresence();
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState('');

  const me = onlineUsers.find((u) => u.userId === myUserId);
  const teammates = onlineUsers.filter((u) => u.userId !== myUserId);

  if (onlineUsers.length === 0) return null;

  async function handleSetStatus() {
    const trimmed = draft.trim();
    try {
      await updatePresenceStatus(trimmed);
      setSaved(trimmed);
      setDraft('');
    } catch {
      toast.error('Failed to update status');
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Users className="w-3 h-3" />
        Team
        <Badge variant="secondary" className="text-detail px-1 py-0 h-4 ml-auto font-normal">
          {onlineUsers.length} online
        </Badge>
      </h3>

      {/* Set your own status */}
      <div className="flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSetStatus()}
          placeholder={saved || 'Set a status…'}
          className="h-7 text-xs"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs shrink-0"
          onClick={handleSetStatus}
          disabled={!draft.trim()}
        >
          Set
        </Button>
      </div>

      {/* You */}
      {me && (
        <div className="flex items-center gap-2 py-0.5">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-detail font-bold text-white shrink-0"
            style={{ backgroundColor: me.color }}
          >
            {(me.displayName[0] ?? '?').toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium truncate">{me.displayName}</p>
              <Badge variant="outline" className="text-detail px-1 py-0 h-3.5">you</Badge>
            </div>
            {(saved || me.statusMessage) && (
              <p className="text-detail text-muted-foreground truncate">{saved || me.statusMessage}</p>
            )}
          </div>
          <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
        </div>
      )}

      {/* Teammate list */}
      {teammates.length > 0 && (
        <div className="space-y-1">
          {teammates.map((u) => (
            <div key={u.userId} className="flex items-center gap-2 py-0.5">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-detail font-bold text-white shrink-0"
                style={{ backgroundColor: u.color }}
              >
                {(u.displayName[0] ?? '?').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-xs font-medium truncate">{u.displayName}</p>
                  {u.isPushing && (
                    <Badge variant="secondary" className="text-detail px-1 py-0 h-3.5 shrink-0">Pushing...</Badge>
                  )}
                </div>
                {u.statusMessage && (
                  <p className="text-detail text-muted-foreground truncate">{u.statusMessage}</p>
                )}
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0" title="Online" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
