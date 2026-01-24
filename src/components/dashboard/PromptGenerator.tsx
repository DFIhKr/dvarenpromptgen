import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
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
import { ScrollArea } from '@/components/ui/scroll-area';

interface PromptGeneratorProps {
  hasActiveKeys: boolean;
}

interface GeneratedPrompt {
  id: number;
  text: string;
}

interface JsonOutput {
  theme: string;
  style_mode: string;
  length_rule: {
    min_words: number;
    max_words: number;
  };
  prompts: GeneratedPrompt[];
}

const MODELS = [
  { value: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout (17B)' },
  { value: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick (17B)' },
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 (70B)' },
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 (8B)' },
];

const STYLE_MODES = [
  { value: 'free_illustration', label: 'Free Illustration' },
  { value: 'typography', label: 'Typography' },
  { value: 'glitch_typography', label: 'Glitch Typography' },
  { value: 'ui_tech_screen', label: 'UI / Tech Screen' },
];

const OUTPUT_FORMATS = [
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'TEXT' },
];

const BATCH_SIZE = 20;

export function PromptGenerator({ hasActiveKeys }: PromptGeneratorProps) {
  const [theme, setTheme] = useState('cyberpunk neon');
  const [model, setModel] = useState(MODELS[0].value);
  const [styleMode, setStyleMode] = useState(STYLE_MODES[2].value); // Default to glitch_typography
  const [outputFormat, setOutputFormat] = useState<'json' | 'text'>('json');
  const [promptCount, setPromptCount] = useState('20');
  const [minWords, setMinWords] = useState(22);
  const [maxWords, setMaxWords] = useState(35);
  const [output, setOutput] = useState<JsonOutput | null>(null);
  const [textOutput, setTextOutput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const { toast } = useToast();

  const handleCountChange = (value: string) => {
    const numericValue = value.replace(/\D/g, '');
    if (numericValue === '' || (parseInt(numericValue) >= 1 && parseInt(numericValue) <= 1000)) {
      setPromptCount(numericValue);
    }
  };

  const handleMinWordsChange = (value: number[]) => {
    const newMin = value[0];
    setMinWords(newMin);
    if (newMin > maxWords) {
      setMaxWords(newMin + 5);
    }
  };

  const handleMaxWordsChange = (value: number[]) => {
    const newMax = value[0];
    setMaxWords(newMax);
    if (newMax < minWords) {
      setMinWords(newMax - 5);
    }
  };

  const getStyleModeLabel = (value: string) => {
    return STYLE_MODES.find(s => s.value === value)?.label || value;
  };

  const handleGenerate = async () => {
    if (!theme.trim()) {
      toast({
        variant: 'destructive',
        title: 'Theme required',
        description: 'Please enter a theme for your prompts.',
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
    setOutput(null);
    setTextOutput('');
    
    setProgress({ current: 0, total: count });

    try {
      const { data, error } = await supabase.functions.invoke('generate-prompts', {
        body: {
          theme: theme.trim(),
          model,
          styleMode,
          outputFormat,
          count,
          minWords,
          maxWords,
        },
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      if (outputFormat === 'text') {
        // TEXT format: numbered list
        const textList = (data.prompts || [])
          .map((text: string, index: number) => `${index + 1}. ${text}`)
          .join('\n');
        setTextOutput(textList);
        setProgress({ current: (data.prompts || []).length, total: count });
      } else {
        // JSON format
        const jsonOutput: JsonOutput = {
          theme: theme.trim(),
          style_mode: getStyleModeLabel(styleMode),
          length_rule: {
            min_words: minWords,
            max_words: maxWords,
          },
          prompts: (data.prompts || []).map((text: string, index: number) => ({
            id: index + 1,
            text,
          })),
        };

        setOutput(jsonOutput);
        setProgress({ current: jsonOutput.prompts.length, total: count });
      }

      if (data.partial) {
        toast({
          variant: 'default',
          title: 'Partial results',
          description: data.message || `Generated ${(data.prompts || []).length} of ${count} prompts.`,
        });
      } else {
        toast({
          title: 'Generation complete',
          description: `Successfully generated ${(data.prompts || []).length} prompts.`,
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

  const copyOutput = async () => {
    if (outputFormat === 'text') {
      if (!textOutput) return;
      await navigator.clipboard.writeText(textOutput);
      toast({
        title: 'Copied!',
        description: 'Text output copied to clipboard.',
      });
    } else {
      if (!output) return;
      await navigator.clipboard.writeText(JSON.stringify(output, null, 2));
      toast({
        title: 'Copied!',
        description: 'JSON output copied to clipboard.',
      });
    }
  };

  const downloadOutput = () => {
    const styleSuffix = styleMode.replace(/_/g, '-');
    const filename = `prompts-${styleSuffix}-${theme.replace(/\s+/g, '-').toLowerCase()}`;
    
    if (outputFormat === 'text') {
      if (!textOutput) return;
      const blob = new Blob([textOutput], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      if (!output) return;
      const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const totalBatches = Math.ceil((parseInt(promptCount) || 0) / BATCH_SIZE);
  const isLargeGeneration = (parseInt(promptCount) || 0) > BATCH_SIZE;
  const progressPercent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  const hasOutput = outputFormat === 'text' ? textOutput.length > 0 : (output?.prompts.length || 0) > 0;
  const outputCount = outputFormat === 'text' ? textOutput.split('\n').filter(l => l.trim()).length : (output?.prompts.length || 0);

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
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="theme">Theme</Label>
            <Input
              id="theme"
              placeholder="e.g., cyberpunk neon, retro VHS, futuristic data corruption..."
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="h-11 bg-muted/50 border-border"
              disabled={!hasActiveKeys || loading}
            />
            <p className="text-xs text-muted-foreground">
              Describe the visual theme for your prompts
            </p>
          </div>

          {/* Style Mode and Output Format */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="styleMode">Style Mode</Label>
              <Select value={styleMode} onValueChange={setStyleMode} disabled={!hasActiveKeys || loading}>
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLE_MODES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="outputFormat">Output Format</Label>
              <Select value={outputFormat} onValueChange={(v) => setOutputFormat(v as 'json' | 'text')} disabled={!hasActiveKeys || loading}>
                <SelectTrigger className="h-11 bg-muted/50 border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTPUT_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              <Label htmlFor="count">Total Prompts</Label>
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

          {/* Word Count Sliders */}
          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/20">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Word Count Range</Label>
              <span className="text-xs text-muted-foreground font-mono">
                {minWords} – {maxWords} words
              </span>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Minimum</Label>
                  <span className="text-xs font-mono text-primary">{minWords}</span>
                </div>
                <Slider
                  value={[minWords]}
                  onValueChange={handleMinWordsChange}
                  min={10}
                  max={50}
                  step={1}
                  disabled={!hasActiveKeys || loading}
                  className="cursor-pointer"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Maximum</Label>
                  <span className="text-xs font-mono text-primary">{maxWords}</span>
                </div>
                <Slider
                  value={[maxWords]}
                  onValueChange={handleMaxWordsChange}
                  min={15}
                  max={60}
                  step={1}
                  disabled={!hasActiveKeys || loading}
                  className="cursor-pointer"
                />
              </div>
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
            disabled={!hasActiveKeys || loading || !theme.trim() || !promptCount}
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
            <Label>Generated Prompts ({outputCount})</Label>
            {hasOutput && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyOutput}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy {outputFormat.toUpperCase()}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={downloadOutput}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download
                </Button>
              </div>
            )}
          </div>

          <ScrollArea className="h-[500px] rounded-xl border border-border bg-muted/30">
            <div className="p-4">
              {!hasOutput ? (
                <div className="flex flex-col items-center justify-center h-[450px] text-muted-foreground">
                  <Sparkles className="h-12 w-12 mb-3 opacity-50" />
                  <p className="text-sm font-medium">{getStyleModeLabel(styleMode)} Prompts</p>
                  <p className="text-xs mt-2 text-center max-w-[220px]">
                    {outputFormat.toUpperCase()} output with {minWords}–{maxWords} word prompts
                  </p>
                  {isLargeGeneration && (
                    <p className="text-xs mt-2 text-center max-w-[200px]">
                      {promptCount} prompts in {totalBatches} batches
                    </p>
                  )}
                </div>
              ) : outputFormat === 'text' ? (
                /* TEXT Output */
                <div className="space-y-2">
                  {textOutput.split('\n').filter(l => l.trim()).map((line, index) => (
                    <div
                      key={index}
                      className="group p-3 rounded-lg bg-card border border-border/50 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex-1 text-sm text-foreground">{line}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyPrompt(line.replace(/^\d+\.\s*/, ''), index)}
                          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {copiedIndex === index ? (
                            <Check className="h-4 w-4 text-primary" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* JSON Output */
                <div className="space-y-3">
                  {/* JSON Header Display */}
                  <div className="p-3 rounded-lg bg-card border border-border/50 font-mono text-xs">
                    <div className="text-muted-foreground">
                      <span className="text-primary">{'{'}</span>
                    </div>
                    <div className="ml-4">
                      <span className="text-primary">"theme"</span>
                      <span className="text-muted-foreground">: </span>
                      <span className="text-accent-foreground">"{output?.theme}"</span>
                      <span className="text-muted-foreground">,</span>
                    </div>
                    <div className="ml-4">
                      <span className="text-primary">"style_mode"</span>
                      <span className="text-muted-foreground">: </span>
                      <span className="text-accent-foreground">"{output?.style_mode}"</span>
                      <span className="text-muted-foreground">,</span>
                    </div>
                    <div className="ml-4">
                      <span className="text-primary">"length_rule"</span>
                      <span className="text-muted-foreground">: {'{'} </span>
                      <span className="text-primary">"min_words"</span>
                      <span className="text-muted-foreground">: </span>
                      <span className="text-foreground">{output?.length_rule.min_words}</span>
                      <span className="text-muted-foreground">, </span>
                      <span className="text-primary">"max_words"</span>
                      <span className="text-muted-foreground">: </span>
                      <span className="text-foreground">{output?.length_rule.max_words}</span>
                      <span className="text-muted-foreground"> {'}'}</span>
                      <span className="text-muted-foreground">,</span>
                    </div>
                    <div className="ml-4">
                      <span className="text-primary">"prompts"</span>
                      <span className="text-muted-foreground">: [</span>
                    </div>
                  </div>

                  {/* Prompts List */}
                  {output?.prompts.map((prompt, index) => (
                    <div
                      key={prompt.id}
                      className="group p-3 rounded-lg bg-card border border-border/50 hover:border-primary/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 font-mono text-xs">
                          <span className="text-muted-foreground ml-6">{'{'}</span>
                          <div className="ml-10">
                            <span className="text-primary">"id"</span>
                            <span className="text-muted-foreground">: </span>
                            <span className="text-foreground">{prompt.id}</span>
                            <span className="text-muted-foreground">,</span>
                          </div>
                          <div className="ml-10">
                            <span className="text-primary">"text"</span>
                            <span className="text-muted-foreground">: </span>
                            <span className="text-accent-foreground break-words">"{prompt.text}"</span>
                          </div>
                          <span className="text-muted-foreground ml-6">{'}'}</span>
                          {index < (output?.prompts.length || 0) - 1 && (
                            <span className="text-muted-foreground">,</span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyPrompt(prompt.text, index)}
                          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {copiedIndex === index ? (
                            <Check className="h-4 w-4 text-primary" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* JSON Footer */}
                  <div className="p-3 rounded-lg bg-card border border-border/50 font-mono text-xs">
                    <div className="ml-4 text-muted-foreground">]</div>
                    <div className="text-primary">{'}'}</div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}