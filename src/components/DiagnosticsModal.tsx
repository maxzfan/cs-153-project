import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { desktopAPI, type DiagnosticReport } from '@/lib/desktop-api';

function formatAsText(report: DiagnosticReport): string {
  const head =
    `0studio diagnostic report — ${report.timestamp}\n` +
    `App version  : ${report.appVersion}\n` +
    `Electron     : ${report.electron}\n` +
    `Chrome       : ${report.chrome}\n` +
    `Node         : ${report.node}\n` +
    `Platform     : ${report.platform}\n` +
    `Locale       : ${report.locale}\n` +
    `Log file     : ${report.logFilePath}\n`;
  const tail = report.logTail ? `\n--- log tail ---\n${report.logTail}` : '';
  return head + tail;
}

export function DiagnosticsModal() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = desktopAPI.onShowDiagnostics(() => {
      setOpen(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setReport(null);
    desktopAPI
      .getDiagnosticReport()
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: 'Diagnostic report failed',
            description: err instanceof Error ? err.message : String(err),
            variant: 'destructive',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: `${label} copied to clipboard.` });
    } catch (err) {
      toast({
        title: 'Copy failed',
        description: err instanceof Error ? err.message : 'Clipboard unavailable',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Diagnostic report</DialogTitle>
          <DialogDescription>
            Versions, platform, and a redacted tail of the log file. Paste in a bug report.
          </DialogDescription>
        </DialogHeader>

        {loading && <div className="text-sm text-muted-foreground">Building report…</div>}

        {report && (
          <Tabs defaultValue="text" className="w-full">
            <TabsList>
              <TabsTrigger value="text">Text</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
            <TabsContent value="text" className="space-y-2">
              <pre className="max-h-[420px] overflow-auto rounded border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                {formatAsText(report)}
              </pre>
              <Button onClick={() => copy(formatAsText(report), 'Text report')}>
                Copy as text
              </Button>
            </TabsContent>
            <TabsContent value="json" className="space-y-2">
              <pre className="max-h-[420px] overflow-auto rounded border bg-muted p-3 font-mono text-xs">
                {JSON.stringify(report, null, 2)}
              </pre>
              <Button onClick={() => copy(JSON.stringify(report, null, 2), 'JSON report')}>
                Copy as JSON
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
