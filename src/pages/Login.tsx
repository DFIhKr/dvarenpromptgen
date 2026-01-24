import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/Logo';
import { Loader2, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const {
    signIn
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    toast
  } = useToast();
  const from = (location.state as {
    from?: {
      pathname: string;
    };
  })?.from?.pathname || '/dashboard';
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const {
      error
    } = await signIn(email, password);
    if (error) {
      toast({
        variant: 'destructive',
        title: 'Login failed',
        description: error.message
      });
      setLoading(false);
      return;
    }
    navigate(from, {
      replace: true
    });
  };
  return <div className="flex min-h-screen">
      {/* Left Panel - Form */}
      <div className="flex flex-1 flex-col justify-center px-8 py-12 lg:px-20">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-10">
            <Link to="/" className="inline-block">
              <Logo size="lg" />
            </Link>
          </div>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
            <p className="mt-2 text-muted-foreground">
              Sign in to access your prompt generator
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required className="h-12 bg-muted/50 border-border" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required className="h-12 bg-muted/50 border-border pr-12" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={loading} className="w-full h-12 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <>
                  Sign In
                  <ArrowRight className="ml-2 h-5 w-5" />
                </>}
            </Button>
          </form>

          <p className="mt-8 text-center text-sm text-muted-foreground">
            Don't have an account?{' '}
            <Link to="/register" className="text-primary hover:underline font-medium">
              Create one
            </Link>
          </p>
        </div>
      </div>

      {/* Right Panel - Visual */}
      <div className="hidden lg:flex lg:flex-1 bg-gradient-dark items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0" style={{
        background: 'var(--gradient-glow)'
      }} />
        <div className="relative z-10 text-center px-12">
          <div className="mb-8">
            <Logo size="lg" showText={false} />
          </div>
          <h2 className="text-4xl font-bold mb-4 text-muted">
            Generate powerful prompts
          </h2>
          <p className="text-lg text-muted-foreground max-w-md">
            Connect your Groq API keys and start generating high-quality prompts using the latest AI models.
          </p>
        </div>
      </div>
    </div>;
}