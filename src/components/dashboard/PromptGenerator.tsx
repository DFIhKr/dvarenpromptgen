import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Sparkles, Copy, Download, Check, AlertCircle, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

interface PromptGeneratorProps {
  hasActiveKeys: boolean;
}

const MODELS = [
  { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout (17B)' },
  { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick (17B)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 (70B)' },
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 (8B)' },
];

const BATCH_SIZE = 20;

export function PromptGenerator({ hasActiveKeys }: PromptGeneratorProps) {
  const [input, setInput] = useState('');
  const [model, setModel] = useState(MODELS[0].value);
  const [promptCount, setPromptCount] = useState('20');
  const [output, setOutput] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const { toast } = useToast();

  const handleCountChange = (value: string) => {
    // Only allow numbers
    const numericValue = value.replace(/\D/g, '');
    if (numericValue === '' || (parseInt(numericValue) >= 1 && parseInt(numericValue) <= 1000)) {
      setPromptCount(numericValue);
    }
  };

  const handleGenerate = async () => {
    if (!input.trim()) {
      toast({
        variant: 'destructive',
        title: 'Input required',
        description: 'Please enter a topic or description for your prompts.',
      });
      return;
    }

    const count = parseInt(promptCount) || 20;
    if (count < 1 || count > 1000) {
      toast({
        variant: 'destructive',
        title: 'Invalid count',
        description: 'Please enter a number between 1 and 1000.',
      });
      return;
    }

    setLoading(true);
    setOutput([]);
    
    const totalBatches = Math.ceil(count / BATCH_SIZE);
    setProgress({ current: 0, total: count });

    try {
      const { data, error } = await supabase.functions.invoke('generate-prompts', {
        body: {
          topic: input.trim(),
          model,
          count,
        },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      const prompts = data.prompts || [];
      setOutput(prompts);
      setProgress({ current: prompts.length, total: count });

      if (data.partial) {
        toast({
          variant: 'default',
          title: 'Partial results',
          description: data.message || `Generated ${prompts.length} of ${count} prompts.`,
        });
      } else {
        toast({
          title: 'Generation complete',
          description: `Successfully generated ${prompts.length} prompts.`,
        });
      }
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

  const copyAllPrompts = async () => {
    const text = output.map((p, i) => `${i + 1}. ${p}`).join('\n\n');
    await navigator.clipboard.writeText(text);
    toast({
      title: 'Copied!',
      description: `${output.length} prompts copied to clipboard.`,
    });
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

  const totalBatches = Math.ceil((parseInt(promptCount) || 0) / BATCH_SIZE);
  const isLargeGeneration = (parseInt(promptCount) || 0) > BATCH_SIZE;
  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

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
              className="min-h-[120px] bg-muted/50 border-border resize-none"
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
              <Input
                id="count"
                type="text"
                inputMode="numeric"
                placeholder="1-1000"
                value={promptCount}
                onChange={(e) => handleCountChange(e.target.value)}
                className="h-11 bg-muted/50 border-border"
                disabled={!hasActiveKeys || loading}
              />
            </div>
          </div>

          {isLargeGeneration && (
            <Alert className="border-primary/30 bg-primary/5">
              <Info className="h-4 w-4 text-primary" />
              <AlertDescription className="text-muted-foreground">
                Large generations are processed in {totalBatches} batches to ensure quality and stability.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleGenerate}
            disabled={!hasActiveKeys || loading || !input.trim() || !promptCount}
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
                Generate {promptCount || 0} Prompts
              </>
            )}
          </Button>

          {loading && isLargeGeneration && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Processing batches...</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          )}
        </div>

        {/* Output Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Generated Prompts ({output.length})</Label>
            {output.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyAllPrompts}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={downloadPrompts}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
              </div>
            )}
          </div>

          <div className="min-h-[280px] rounded-xl border border-border bg-muted/30 p-4 overflow-y-auto max-h-[500px]">
            {output.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Sparkles className="h-12 w-12 mb-3 opacity-50" />
                <p className="text-sm">Generated prompts will appear here</p>
                {isLargeGeneration && (
                  <p className="text-xs mt-2 text-center max-w-[200px]">
                    Your {promptCount} prompts will be generated in {totalBatches} batches
                  </p>
                )}
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
