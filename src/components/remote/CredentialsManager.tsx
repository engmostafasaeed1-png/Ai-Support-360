import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, Key, Eye, EyeOff, Shield, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  useEnvironmentCredentials, useCreateCredential, useUpdateCredential, useDeleteCredential,
  type EnvironmentCredential,
} from '@/hooks/useEnvironmentCredentials';
import { decryptCredential } from '@/lib/credentialsCrypto';
import { toast } from 'sonner';

interface CredentialsManagerProps {
  environmentId: string;
  /** If true, user can add/edit/delete. If false, read-only (consultant view). */
  canEdit?: boolean;
}

export default function CredentialsManager({ environmentId, canEdit = true }: CredentialsManagerProps) {
  const { t } = useTranslation();
  const { data: credentials, isLoading } = useEnvironmentCredentials(environmentId);
  const createCred = useCreateCredential();
  const updateCred = useUpdateCredential();
  const deleteCred = useDeleteCredential();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCred, setEditingCred] = useState<EnvironmentCredential | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<Record<string, boolean>>({});

  // Form state
  const [label, setLabel] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('3389');
  const [domain, setDomain] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const resetForm = () => {
    setLabel('');
    setHostname('');
    setPort('3389');
    setDomain('');
    setUsername('');
    setPassword('');
    setEditingCred(null);
  };

  const openAdd = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (cred: EnvironmentCredential) => {
    setEditingCred(cred);
    setLabel(cred.credential_label);
    setHostname(cred.hostname || '');
    setPort(String(cred.port));
    setDomain(cred.domain || '');
    setUsername(cred.username);
    // Leave password blank — user must re-enter to change it.
    setPassword('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!username) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (editingCred) {
      updateCred.mutate({
        id: editingCred.id,
        environment_id: environmentId,
        credential_label: label || 'Default',
        hostname: hostname || null,
        port: parseInt(port) || 3389,
        domain: domain || null,
        username,
        // Only send password if user typed a new one.
        ...(password ? { password } : {}),
      });
    } else {
      if (!password) return;
      createCred.mutate({
        environment_id: environmentId,
        credential_label: label || 'Default',
        hostname: hostname || null,
        port: parseInt(port) || 3389,
        domain: domain || null,
        username,
        password,
        entered_by: user.id,
      });
    }
    setDialogOpen(false);
    resetForm();
  };

  const togglePassword = async (cred: EnvironmentCredential) => {
    const id = cred.id;
    const willShow = !showPasswords[id];
    setShowPasswords(prev => ({ ...prev, [id]: willShow }));
    if (willShow && !revealedPasswords[id] && cred.password_ciphertext) {
      setRevealing(prev => ({ ...prev, [id]: true }));
      try {
        const plain = await decryptCredential(
          'environment_credentials',
          'password_ciphertext',
          id,
        );
        setRevealedPasswords(prev => ({ ...prev, [id]: plain }));
      } catch (e: any) {
        toast.error('Failed to reveal password', { description: e.message });
        setShowPasswords(prev => ({ ...prev, [id]: false }));
      } finally {
        setRevealing(prev => ({ ...prev, [id]: false }));
      }
    }
  };

  if (isLoading) return <Skeleton className="h-16 rounded-xl" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Shield className="w-3 h-3" /> {t('remote.credentials', 'Server Credentials')}
        </p>
        {canEdit && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={openAdd}>
            <Plus className="w-3 h-3" /> {t('common.add', 'Add')}
          </Button>
        )}
      </div>

      {(!credentials || credentials.length === 0) ? (
        <div className="p-3 rounded-xl border border-dashed border-border/50 bg-muted/20 text-center">
          <Key className="w-5 h-5 text-muted-foreground/40 mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">
            {canEdit
              ? t('remote.no_credentials_client', 'No credentials added. Add server login details for your consultant.')
              : t('remote.no_credentials_consultant', 'No credentials provided by the client yet.')}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {credentials.map((cred) => (
            <div key={cred.id} className="p-3 rounded-xl border border-border/40 bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-sm font-medium text-foreground">{cred.credential_label}</span>
                  {cred.hostname && (
                    <Badge variant="outline" className="text-[9px]">{cred.hostname}:{cred.port}</Badge>
                  )}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(cred)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-2xl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t('remote.delete_cred', 'Delete Credentials')}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t('remote.delete_cred_desc', 'This will permanently remove these server credentials. The consultant will lose access.')}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground"
                            onClick={() => deleteCred.mutate({ id: cred.id, environmentId })}
                          >
                            {t('common.delete', 'Delete')}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {cred.domain && (
                  <div>
                    <span className="text-muted-foreground">Domain:</span>{' '}
                    <span className="text-foreground font-mono">{cred.domain}</span>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Username:</span>{' '}
                  <span className="text-foreground font-mono">{cred.username}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Password:</span>{' '}
                  <span className="text-foreground font-mono">
                    {showPasswords[cred.id]
                      ? (revealing[cred.id] ? '…' : (revealedPasswords[cred.id] ?? '••••••••'))
                      : '••••••••'}
                  </span>
                  <button onClick={() => togglePassword(cred)} className="text-muted-foreground hover:text-foreground">
                    {showPasswords[cred.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              {editingCred
                ? t('remote.edit_credentials', 'Edit Credentials')
                : t('remote.add_credentials', 'Add Server Credentials')}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            {t('remote.credentials_disclaimer', 'Credentials are stored securely and shared only with the assigned consultant for remote access sessions.')}
          </p>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('remote.cred_label', 'Label')}</Label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="SAP Production Login" className="h-8 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('remote.cred_hostname', 'Server Hostname')}</Label>
                <Input value={hostname} onChange={e => setHostname(e.target.value)} placeholder="192.168.1.100" className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">{t('remote.cred_port', 'Port')}</Label>
                <Input value={port} onChange={e => setPort(e.target.value)} type="number" className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <Label className="text-xs">{t('remote.cred_domain', 'Domain (optional)')}</Label>
              <Input value={domain} onChange={e => setDomain(e.target.value)} placeholder="CORP" className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">{t('remote.cred_username', 'Username')}</Label>
              <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" className="h-8 text-sm" autoComplete="off" />
            </div>
            <div>
              <Label className="text-xs">{t('remote.cred_password', 'Password')}</Label>
              <Input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="••••••••" className="h-8 text-sm" autoComplete="new-password" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" onClick={resetForm}>{t('common.cancel', 'Cancel')}</Button>
            </DialogClose>
            <Button className="gradient-primary border-0" onClick={handleSave} disabled={!username || !password}>
              <Shield className="w-4 h-4 me-1" />
              {editingCred ? t('common.update', 'Update') : t('remote.save_credentials', 'Save Securely')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
