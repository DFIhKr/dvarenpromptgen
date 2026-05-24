import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Shield } from 'lucide-react';

interface SourceOwnerToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function SourceOwnerToggle({ checked, onCheckedChange, disabled }: SourceOwnerToggleProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-3">
        <Shield className="h-4 w-4 text-primary" />
        <div className="space-y-0.5">
          <Label htmlFor="source-owner" className="text-sm font-medium">Use Source Owner</Label>
          <p className="text-xs text-muted-foreground">
            {checked
              ? 'Using owner\'s API source (Claude Sonnet 4.5)'
              : 'Use owner\'s API instead of your own key'}
          </p>
        </div>
      </div>
      <Switch
        id="source-owner"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
