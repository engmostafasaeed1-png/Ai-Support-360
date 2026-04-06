import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {}

export default function PasswordInput(props: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className={`pe-10 ${props.className ?? ''}`} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute end-0 top-0 h-full w-10 text-muted-foreground hover:text-foreground"
        onClick={() => setShow(v => !v)}
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </Button>
    </div>
  );
}
