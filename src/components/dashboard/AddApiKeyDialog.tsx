import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Key, Loader2, ExternalLink } from 'lucide-react';

interface AddApiKeyDialogProps {
  onAdd: (apiKey: string, provider: 'groq' | 'openrouter', label?: string) => Promise<void>;
  disabled?: boolean;
  keyCount: number;
}

const PROVIDERS = [
  { 
    value: 'groq' as const, 
    label: 'Groq',
    placeholder: 'gsk_...',
    prefix: 'gsk_',
    url: 'https://console.groq.com/keys',
    urlLabel: 'console.groq.com',
  },
  { 
    value: 'openrouter' as const, 
    label: 'OpenRouter',
    placeholder: 'sk-or-v1-...',
    prefix: 'sk-or-',
    url: 'https://openrouter.ai/keys',
    urlLabel: 'openrouter.ai/keys',
  },
];

export function AddApiKeyDialog({ onAdd, disabled, keyCount }: AddApiKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<'groq' | 'openrouter'>('groq');
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);

  const currentProvider = PROVIDERS.find(p => p.value === provider)!;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setLoading(true);
    try {
      await onAdd(apiKey.trim(), provider, label.trim() || undefined);
      setApiKey('');
      setLabel('');
      setProvider('groq');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const isMaxKeys = keyCount >= 5;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          disabled={disabled || isMaxKeys}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add API Key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            Add API Key
          </DialogTitle>
          <DialogDescription>
            Your API key will be encrypted and stored securely. It will never be visible again.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Provider Selection */}
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as 'groq' | 'openrouter')}>
              <SelectTrigger className="h-11 bg-muted/50 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Alert className="border-info/50 bg-info/10">
            <AlertDescription className="text-sm">
              Get your API key at{' '}
              <a
                href={currentProvider.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-medium inline-flex items-center gap-1"
              >
                {currentProvider.urlLabel}
                <ExternalLink className="h-3 w-3" />
              </a>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder={currentProvider.placeholder}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              className="h-11 bg-muted/50 border-border font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="label">Label (optional)</Label>
            <Input
              id="label"
              type="text"
              placeholder="e.g., Primary Key"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-11 bg-muted/50 border-border"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !apiKey.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Add Key'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
