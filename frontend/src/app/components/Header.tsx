import { Music, User, LogOut, ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';

interface HeaderProps {
  onBack?: () => void;
  showBack?: boolean;
  userName?: string;
  onLogin?: () => void;
  onLogout?: () => void;
}

export function Header({ onBack, showBack = false, userName = '게스트', onLogin, onLogout }: HeaderProps) {
  return (
    <header className="h-14 border-b border-white/10 bg-zinc-900/80 backdrop-blur-xl flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        {showBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-2 text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
        )}
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Music className="size-4 text-white" />
          </div>
          <span className="font-semibold text-white">Dance + Magic Analysis Lab</span>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
          <User className="size-4 text-zinc-400" />
          <span className="text-sm text-zinc-300">{userName}</span>
        </div>
        {onLogin && userName === '게스트' ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-zinc-400 hover:text-white"
            onClick={onLogin}
          >
            <LogOut className="size-4" />
            Login
          </Button>
        ) : onLogout ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-zinc-400 hover:text-white"
            onClick={onLogout}
          >
            <LogOut className="size-4" />
            Logout
          </Button>
        ) : null}
      </div>
    </header>
  );
}
