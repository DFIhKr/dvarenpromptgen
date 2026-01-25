import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { LogOut, Users, Eye, MessageSquare, Activity, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, subDays, startOfDay, startOfWeek, startOfMonth } from 'date-fns';

interface VisitorStats {
  total: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
}

interface UserStats {
  totalUsers: number;
  activeUsers: number;
}

interface UserActivity {
  userId: string;
  email: string;
  lastActiveAt: string;
  isOnline: boolean;
}

interface UserPromptStats {
  userId: string;
  email: string;
  totalPrompts: number;
  promptsToday: number;
  promptsThisMonth: number;
  lastGenerationAt: string | null;
}

interface ProviderStats {
  groq: number;
  openrouter: number;
}

export default function Admin() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  
  const [visitorStats, setVisitorStats] = useState<VisitorStats | null>(null);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [userActivities, setUserActivities] = useState<UserActivity[]>([]);
  const [userPromptStats, setUserPromptStats] = useState<UserPromptStats[]>([]);
  const [providerStats, setProviderStats] = useState<ProviderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAllData = async () => {
    try {
      setError(null);
      
      const now = new Date();
      const todayStart = startOfDay(now).toISOString();
      const weekStart = startOfWeek(now).toISOString();
      const monthStart = startOfMonth(now).toISOString();

      // Fetch visitor stats
      const [totalVisitors, todayVisitors, weekVisitors, monthVisitors] = await Promise.all([
        supabase.from('page_views').select('visitor_id', { count: 'exact', head: true }),
        supabase.from('page_views').select('visitor_id', { count: 'exact', head: true }).gte('created_at', todayStart),
        supabase.from('page_views').select('visitor_id', { count: 'exact', head: true }).gte('created_at', weekStart),
        supabase.from('page_views').select('visitor_id', { count: 'exact', head: true }).gte('created_at', monthStart),
      ]);

      setVisitorStats({
        total: totalVisitors.count || 0,
        today: todayVisitors.count || 0,
        thisWeek: weekVisitors.count || 0,
        thisMonth: monthVisitors.count || 0,
      });

      // Fetch user stats
      const { count: totalUsers } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { count: activeUsers } = await supabase
        .from('user_activity')
        .select('*', { count: 'exact', head: true })
        .eq('is_online', true)
        .gte('last_active_at', fiveMinutesAgo);

      setUserStats({
        totalUsers: totalUsers || 0,
        activeUsers: activeUsers || 0,
      });

      // Fetch user activities with profiles
      const { data: activities } = await supabase
        .from('user_activity')
        .select('user_id, last_active_at, is_online')
        .order('last_active_at', { ascending: false })
        .limit(50);

      if (activities && activities.length > 0) {
        const userIds = activities.map(a => a.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, email')
          .in('user_id', userIds);

        const profileMap = new Map(profiles?.map(p => [p.user_id, p.email]) || []);
        
        setUserActivities(activities.map(a => ({
          userId: a.user_id,
          email: profileMap.get(a.user_id) || 'Unknown',
          lastActiveAt: a.last_active_at,
          isOnline: a.is_online && new Date(a.last_active_at) > new Date(fiveMinutesAgo),
        })));
      }

      // Fetch prompt stats per user
      const { data: promptLogs } = await supabase
        .from('prompt_logs')
        .select('user_id, prompt_count, created_at, model');

      if (promptLogs && promptLogs.length > 0) {
        const userIds = [...new Set(promptLogs.map(p => p.user_id))];
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, email')
          .in('user_id', userIds);

        const profileMap = new Map(profiles?.map(p => [p.user_id, p.email]) || []);
        
        // Group by user
        const userPrompts = new Map<string, { total: number; today: number; thisMonth: number; lastGen: string | null }>();
        
        for (const log of promptLogs) {
          const existing = userPrompts.get(log.user_id) || { total: 0, today: 0, thisMonth: 0, lastGen: null };
          existing.total += log.prompt_count;
          
          const logDate = new Date(log.created_at);
          if (logDate >= new Date(todayStart)) {
            existing.today += log.prompt_count;
          }
          if (logDate >= new Date(monthStart)) {
            existing.thisMonth += log.prompt_count;
          }
          
          if (!existing.lastGen || new Date(log.created_at) > new Date(existing.lastGen)) {
            existing.lastGen = log.created_at;
          }
          
          userPrompts.set(log.user_id, existing);
        }

        setUserPromptStats(
          Array.from(userPrompts.entries()).map(([userId, stats]) => ({
            userId,
            email: profileMap.get(userId) || 'Unknown',
            totalPrompts: stats.total,
            promptsToday: stats.today,
            promptsThisMonth: stats.thisMonth,
            lastGenerationAt: stats.lastGen,
          })).sort((a, b) => b.totalPrompts - a.totalPrompts)
        );

        // Calculate provider stats from model names
        let groqCount = 0;
        let openrouterCount = 0;
        
        for (const log of promptLogs) {
          // Groq models typically don't have slashes, OpenRouter models do
          if (log.model.includes('/')) {
            openrouterCount += log.prompt_count;
          } else {
            groqCount += log.prompt_count;
          }
        }

        setProviderStats({ groq: groqCount, openrouter: openrouterCount });
      }

    } catch (err) {
      console.error('Error fetching admin data:', err);
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAllData();
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <Skeleton className="h-12 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo />
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              Admin Dashboard
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {error && (
          <Card className="border-destructive bg-destructive/10">
            <CardContent className="pt-4">
              <p className="text-destructive">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* Visitor Analytics */}
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Visitor Analytics
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Page Views</CardDescription>
                <CardTitle className="text-3xl">{visitorStats?.total.toLocaleString() || 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Today</CardDescription>
                <CardTitle className="text-3xl">{visitorStats?.today.toLocaleString() || 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>This Week</CardDescription>
                <CardTitle className="text-3xl">{visitorStats?.thisWeek.toLocaleString() || 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>This Month</CardDescription>
                <CardTitle className="text-3xl">{visitorStats?.thisMonth.toLocaleString() || 0}</CardTitle>
              </CardHeader>
            </Card>
          </div>
        </section>

        {/* User Overview */}
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="h-5 w-5" />
            User Overview
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Registered Users</CardDescription>
                <CardTitle className="text-3xl">{userStats?.totalUsers.toLocaleString() || 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Currently Active</CardDescription>
                <CardTitle className="text-3xl text-primary">{userStats?.activeUsers.toLocaleString() || 0}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          {userActivities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent User Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userActivities.slice(0, 10).map((activity) => (
                      <TableRow key={activity.userId}>
                        <TableCell className="font-mono text-sm">{activity.email}</TableCell>
                        <TableCell>
                          <Badge variant={activity.isOnline ? 'default' : 'secondary'}>
                            {activity.isOnline ? 'Online' : 'Offline'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(activity.lastActiveAt), 'MMM d, yyyy HH:mm')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </section>

        {/* Prompt Usage Statistics */}
        <section>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Prompt Usage Statistics
          </h2>

          {providerStats && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <Card className="border-l-4 border-l-orange-500">
                <CardHeader className="pb-2">
                  <CardDescription>Groq Prompts</CardDescription>
                  <CardTitle className="text-3xl">{providerStats.groq.toLocaleString()}</CardTitle>
                </CardHeader>
              </Card>
              <Card className="border-l-4 border-l-violet-500">
                <CardHeader className="pb-2">
                  <CardDescription>OpenRouter Prompts</CardDescription>
                  <CardTitle className="text-3xl">{providerStats.openrouter.toLocaleString()}</CardTitle>
                </CardHeader>
              </Card>
            </div>
          )}

          {userPromptStats.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Per-User Prompt Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Today</TableHead>
                      <TableHead className="text-right">This Month</TableHead>
                      <TableHead>Last Generation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userPromptStats.map((stats) => (
                      <TableRow key={stats.userId}>
                        <TableCell className="font-mono text-sm">{stats.email}</TableCell>
                        <TableCell className="text-right font-semibold">{stats.totalPrompts.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{stats.promptsToday.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{stats.promptsThisMonth.toLocaleString()}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {stats.lastGenerationAt
                            ? format(new Date(stats.lastGenerationAt), 'MMM d, yyyy HH:mm')
                            : 'Never'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-center">No prompt generation data available yet.</p>
              </CardContent>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
