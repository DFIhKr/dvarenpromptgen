import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Sparkles, Copy, Download, Check, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PromptGeneratorProps {
  hasActiveKeys: boolean;
}

const MODELS = [
  { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout (17B)' },
  { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick (17B)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 (70B)' },
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 (8B)' },
];

export function PromptGenerator({ hasActiveKeys }: PromptGeneratorProps) {
  const [input, setInput] = useState('');
  const [model, setModel] = useState(MODELS[0].value);
  const [promptCount, setPromptCount] = useState('5');
  const [output, setOutput] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const { toast } = useToast();

  const handleGenerate = async () => {
    if (!input.trim()) {
      toast({
        variant: 'destructive',
        title: 'Input required',
        description: 'Please enter a topic or description for your prompts.',
      });
      return;
    }

    setLoading(true);
    setOutput([]);

    try {
      const { data, error } = await supabase.functions.invoke('generate-prompts', {
        body: {
          topic: input.trim(),
          model,
          count: parseInt(promptCount),
        },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setOutput(data.prompts || []);
    } catch (error) {
      console.error('Generation error:', error);
      toast({
        variant: 'destructive',
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Failed to generate prompts',
      });
    } finally {
      setLoading(false);
    }
  };

  const copyPrompt = async (prompt: string, index: number) => {
    await navigator.clipboard.writeText(prompt);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const downloadPrompts = () => {
    const text = output.map((p, i) => `${i + 1}. ${p}`).join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompts.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {!hasActiveKeys && (
        <Alert className="border-warning/50 bg-warning/10">
          <AlertCircle className="h-4 w-4 text-warning" />
          <AlertDescription>
            You need at least one active API key to generate prompts. Add one above to get started.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Input Section */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="topic">Topic or Description</Label>
            <Textarea
              id="topic"
              placeholder="e.g., Write creative writing prompts about time travel adventures..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="min-h-[160px] bg-muted/50 border-border resize-none"
              disabled={!hasActiveKeys || loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select value={model} onValueChange={setModel} disabled={!hasActiveKeys || loading}>
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="count">Number of Prompts</Label>
              <Select value={promptCount} onValueChange={setPromptCount} disabled={!hasActiveKeys || loading}>
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[5, 10, 15, 20].map((n) => (
                    <SelectItem key={n} value={n.toString()}>
                      {n} prompts
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!hasActiveKeys || loading || !input.trim()}
            className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5 mr-2" />
                Generate Prompts
              </>
            )}
          </Button>
        </div>

        {/* Output Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Generated Prompts</Label>
            {output.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadPrompts}
                className="text-muted-foreground hover:text-foreground"
              >
                <Download className="h-4 w-4 mr-1" />
                Download All
              </Button>
            )}
          </div>

          <div className="min-h-[280px] rounded-xl border border-border bg-muted/30 p-4 overflow-y-auto max-h-[400px]">
            {output.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Sparkles className="h-12 w-12 mb-3 opacity-50" />
                <p className="text-sm">Generated prompts will appear here</p>
              </div>
            ) : (
              <div className="space-y-3">
                {output.map((prompt, index) => (
                  <div
                    key={index}
                    className="group p-3 rounded-lg bg-card border border-border/50 hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-foreground flex-1">
                        <span className="text-primary font-medium">{index + 1}.</span>{' '}
                        {prompt}
                      </p>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyPrompt(prompt, index)}
                        className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {copiedIndex === index ? (
                          <Check className="h-4 w-4 text-success" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
