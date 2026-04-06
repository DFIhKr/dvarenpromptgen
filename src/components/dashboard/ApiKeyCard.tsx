import { Button } from '@/components/ui/button';
import { Key, PowerOff, Power, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApiKeyCardProps {
  id: string;
  keyHint: string;
  label: string | null;
  provider: 'groq' | 'openrouter' | 'gemini';
  isActive: boolean;
  createdAt: string;
  onToggle: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
}

const PROVIDER_LABELS: Record<string, { label: string; className: string }> = {
  groq: { label: 'Groq', className: 'bg-orange-500/20 text-orange-400' },
  openrouter: { label: 'OpenRouter', className: 'bg-violet-500/20 text-violet-400' },
  gemini: { label: 'Gemini', className: 'bg-blue-500/20 text-blue-400' },
};

export function ApiKeyCard({
  id,
  keyHint,
  label,
  provider,
  isActive,
  createdAt,
  onToggle,
  onDelete,
}: ApiKeyCardProps) {
  const providerInfo = PROVIDER_LABELS[provider] || PROVIDER_LABELS.groq;

  return (
    <div
      className={cn(
        'group relative p-4 rounded-xl border transition-all duration-200',
        isActive
          ? 'bg-card border-primary/30 hover:border-primary/50'
          : 'bg-muted/30 border-border opacity-60 hover:opacity-80'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-lg',
              isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
            )}
          >
            <Key className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground">
                {label || 'API Key'}
              </p>
              <span className={cn('px-1.5 py-0.5 text-xs font-medium rounded', providerInfo.className)}>
                {providerInfo.label}
              </span>
            </div>
            <p className="text-sm font-mono text-muted-foreground">
              {keyHint}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'px-2 py-1 text-xs font-medium rounded-full',
              isActive
                ? 'bg-success/20 text-success'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {isActive ? 'Active' : 'Disabled'}
          </span>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onToggle(id, !isActive)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            {isActive ? (
              <PowerOff className="h-4 w-4" />
            ) : (
              <Power className="h-4 w-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(id)}
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Added {new Date(createdAt).toLocaleDateString()}
      </p>
    </div>
  );
}
