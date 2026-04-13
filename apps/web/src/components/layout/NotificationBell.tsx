"use client";

import { useEffect, useCallback } from "react";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { notifications as notifApi } from "@/lib/api";
import { useSocket } from "@/contexts/SocketContext";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { Notification } from "@shift-sync/shared";

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { on } = useSocket();

  const { data: notifs = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn:  () => notifApi.list(),
  });

  const unreadCount = notifs.filter((n) => !n.read).length;

  // Real-time: invalidate on new notification
  useEffect(() => {
    return on("NOTIFICATION", () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
  }, [on, queryClient]);

  const handleMarkAllRead = useCallback(async () => {
    await notifApi.markAllRead();
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }, [queryClient]);

  const handleMarkRead = useCallback(async (id: string) => {
    await notifApi.markRead(id);
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }, [queryClient]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-[10px] flex items-center justify-center"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-semibold">Notifications</h3>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="text-xs">
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {notifs.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No notifications
            </p>
          ) : (
            notifs.slice(0, 20).map((n) => (
              <NotificationItem key={n.id} notification={n} onRead={handleMarkRead} />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationItem({
  notification: n,
  onRead,
}: {
  notification: Notification;
  onRead: (id: string) => void;
}) {
  return (
    <button
      className={cn(
        "w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted/50 transition-colors",
        !n.read && "bg-blue-50/50",
      )}
      onClick={() => !n.read && onRead(n.id)}
    >
      <div className="flex items-start gap-2">
        <div className={cn("mt-1 h-2 w-2 rounded-full shrink-0", !n.read ? "bg-blue-500" : "bg-transparent")} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug">{n.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">{n.body}</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
          </p>
        </div>
      </div>
    </button>
  );
}
