import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Building2, Globe, MapPin, Save, Loader2, Plus, Trash2,
  Server, Database, Users2, Mail, Phone, Briefcase, Camera,
  HardDrive, Cpu, Calendar, Code, Link2, Package, Upload,
} from 'lucide-react';
import { useClientProfileData, useUpdateClientProfile, type ClientProfile } from '@/hooks/useClientProfile';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const industries = [
  'Manufacturing', 'Retail', 'Oil & Gas', 'Healthcare', 'Finance & Banking',
  'Utilities', 'Government', 'Telecommunications', 'Transportation', 'Education',
  'Real Estate', 'Construction', 'Food & Beverage', 'Pharmaceuticals', 'Other',
];

const companySizes = ['1-50', '51-200', '201-500', '501-1000', '1001-5000', '5000+'];

interface Contact {
  name: string;
  role: string;
  email: string;
  phone: string;
}

export default function CompanyProfilePage() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const { data: profile, isLoading } = useClientProfileData();
  const updateProfile = useUpdateClientProfile();

  const [companyName, setCompanyName] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [industry, setIndustry] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [headquarters, setHeadquarters] = useState('');
  const [sapLandscape, setSapLandscape] = useState('');
  const [sapHostingType, setSapHostingType] = useState('on-prem');
  const [sapSystemIds, setSapSystemIds] = useState<string[]>([]);
  const [newSystemId, setNewSystemId] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUploadProgress, setLogoUploadProgress] = useState(0);
  const logoProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  // When a drop happens while a logo already exists, hold the file here until
  // the user confirms the replace dialog.
  const pendingDropRef = useRef<{ file: File; ext: string } | null>(null);
  const dragDepthRef = useRef(0);

  // Open the file picker; if a logo already exists, ask for confirmation first.
  const requestLogoSelect = () => {
    if (uploadingLogo) return;
    pendingDropRef.current = null;
    if (logoUrl) {
      setConfirmReplaceOpen(true);
    } else {
      logoInputRef.current?.click();
    }
  };

  const confirmReplaceLogo = () => {
    setConfirmReplaceOpen(false);
    const pending = pendingDropRef.current;
    pendingDropRef.current = null;
    if (pending) {
      // Drag-and-drop path — bypass the file picker.
      void processLogoFile(pending.file, pending.ext);
      return;
    }
    // Defer to next tick so the dialog unmounts cleanly before the file dialog opens.
    setTimeout(() => logoInputRef.current?.click(), 0);
  };

  const cancelReplaceLogo = () => {
    pendingDropRef.current = null;
    setConfirmReplaceOpen(false);
  };
  const [loaded, setLoaded] = useState(false);

  // New landscape fields
  const [sapProduct, setSapProduct] = useState('');
  const [sapVersion, setSapVersion] = useState('');
  const [sapDatabaseType, setSapDatabaseType] = useState('');
  const [sapOsType, setSapOsType] = useState('');
  const [sapSupportPack, setSapSupportPack] = useState('');
  const [sapGoLiveDate, setSapGoLiveDate] = useState('');
  const [sapUserCount, setSapUserCount] = useState<number | ''>('');
  const [sapCustomDevCount, setSapCustomDevCount] = useState<number | ''>('');
  const [sapInterfaces, setSapInterfaces] = useState<string[]>([]);
  const [newInterface, setNewInterface] = useState('');
  const [sapThirdPartyTools, setSapThirdPartyTools] = useState<string[]>([]);
  const [newTool, setNewTool] = useState('');
  const [sapLandscapeNotes, setSapLandscapeNotes] = useState('');

  useEffect(() => {
    if (profile && !loaded) {
      setCompanyName(profile.company_name || '');
      setCompanySize(profile.company_size || '');
      setIndustry(profile.industry || '');
      setDescription(profile.company_description || '');
      setWebsite(profile.company_website || '');
      setHeadquarters(profile.headquarters || '');
      setSapLandscape(profile.sap_landscape || '');
      setSapHostingType(profile.sap_hosting_type || 'on-prem');
      setSapSystemIds(profile.sap_system_ids || []);
      setContacts((profile.key_contacts || []) as Contact[]);
      setLogoUrl(profile.company_logo_url || null);
      setSapProduct(profile.sap_product || '');
      setSapVersion(profile.sap_version || '');
      setSapDatabaseType(profile.sap_database_type || '');
      setSapOsType(profile.sap_os_type || '');
      setSapSupportPack(profile.sap_support_pack || '');
      setSapGoLiveDate(profile.sap_go_live_date || '');
      setSapUserCount(profile.sap_user_count ?? '');
      setSapCustomDevCount(profile.sap_custom_dev_count ?? '');
      setSapInterfaces(profile.sap_interfaces || []);
      setSapThirdPartyTools(profile.sap_third_party_tools || []);
      setSapLandscapeNotes(profile.sap_landscape_notes || '');
      setLoaded(true);
    }
  }, [profile, loaded]);

  const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
  const ALLOWED_LOGO_EXTS = ['png', 'jpg', 'jpeg', 'webp'] as const;
  const MAX_LOGO_BYTES = 5 * 1024 * 1024; // 5MB

  const resetLogoInput = () => {
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  // Validate the file using the same rules used by the file-picker path.
  // Returns the normalized extension (without the dot) or null if invalid.
  const validateLogoFile = (file: File): string | null => {
    if (!(ALLOWED_LOGO_TYPES as readonly string[]).includes(file.type)) {
      toast.error('Unsupported file type', {
        description: 'Please upload a PNG, JPG, or WebP image.',
      });
      return null;
    }
    const extRaw = (file.name.split('.').pop() || '').toLowerCase();
    if (!(ALLOWED_LOGO_EXTS as readonly string[]).includes(extRaw)) {
      toast.error('Unsupported file extension', {
        description: 'Allowed extensions: .png, .jpg, .jpeg, .webp',
      });
      return null;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('File too large', {
        description: `Max size is ${(MAX_LOGO_BYTES / (1024 * 1024)).toFixed(0)}MB.`,
      });
      return null;
    }
    if (file.size === 0) {
      toast.error('Empty file', { description: 'The selected file is empty.' });
      return null;
    }
    return extRaw;
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const extRaw = validateLogoFile(file);
    if (!extRaw) {
      resetLogoInput();
      return;
    }
    await processLogoFile(file, extRaw);
  };

  const processLogoFile = async (file: File, extRaw: string) => {
    setUploadingLogo(true);
    setLogoUploadProgress(5);
    // Supabase JS upload doesn't surface progress events; simulate a smooth
    // ramp up to 90% so the user gets responsive feedback during the request.
    if (logoProgressTimerRef.current) clearInterval(logoProgressTimerRef.current);
    logoProgressTimerRef.current = setInterval(() => {
      setLogoUploadProgress((p) => (p < 90 ? p + Math.max(1, Math.round((90 - p) * 0.15)) : p));
    }, 200);
    const bucket = 'avatars';
    let path = '';
    let uploadOk = false;
    let errCode: string | null = null;
    let errMessage: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const ext = extRaw === 'jpeg' ? 'jpg' : extRaw;
      path = `${user.id}/company-logo.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const newUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      setLogoUrl(newUrl);
      updateProfile.mutate({ company_logo_url: newUrl });
      setLogoUploadProgress(100);
      uploadOk = true;
      toast.success('Logo uploaded');
    } catch (err: any) {
      errCode = err?.statusCode || err?.code || err?.name || 'unknown_error';
      errMessage = err?.message || String(err);
      toast.error('Upload failed', { description: errMessage });
      setLogoUploadProgress(0);
    } finally {
      // Server-side log every attempt (success + failure) for debugging.
      // Best-effort: never block UI on logging errors.
      try {
        await supabase.functions.invoke('log-logo-upload', {
          body: {
            bucket,
            path,
            file_name: file.name,
            file_type: file.type,
            file_size: file.size,
            success: uploadOk,
            error_code: errCode,
            error_message: errMessage,
          },
        });
      } catch (logErr) {
        // eslint-disable-next-line no-console
        console.warn('Failed to record logo upload attempt', logErr);
      }
      if (logoProgressTimerRef.current) {
        clearInterval(logoProgressTimerRef.current);
        logoProgressTimerRef.current = null;
      }
      setTimeout(() => {
        setUploadingLogo(false);
        setLogoUploadProgress(0);
      }, 400);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleSave = () => {
    if (isGuest) {
      toast.success('Changes saved (demo mode)');
      return;
    }
    updateProfile.mutate({
      company_name: companyName.trim() || null,
      company_size: companySize || null,
      industry: industry || null,
      company_description: description.trim() || null,
      company_website: website.trim() || null,
      headquarters: headquarters.trim() || null,
      sap_landscape: sapLandscape.trim() || null,
      sap_hosting_type: sapHostingType,
      sap_system_ids: sapSystemIds,
      key_contacts: contacts,
      sap_product: sapProduct.trim() || null,
      sap_version: sapVersion.trim() || null,
      sap_database_type: sapDatabaseType || null,
      sap_os_type: sapOsType || null,
      sap_support_pack: sapSupportPack.trim() || null,
      sap_go_live_date: sapGoLiveDate || null,
      sap_user_count: sapUserCount === '' ? null : sapUserCount,
      sap_custom_dev_count: sapCustomDevCount === '' ? null : sapCustomDevCount,
      sap_interfaces: sapInterfaces,
      sap_third_party_tools: sapThirdPartyTools,
      sap_landscape_notes: sapLandscapeNotes.trim() || null,
    });
  };

  const addSystemId = () => {
    if (newSystemId.trim() && !sapSystemIds.includes(newSystemId.trim().toUpperCase())) {
      setSapSystemIds([...sapSystemIds, newSystemId.trim().toUpperCase()]);
      setNewSystemId('');
    }
  };

  const addContact = () => {
    setContacts([...contacts, { name: '', role: '', email: '', phone: '' }]);
  };

  const updateContact = (index: number, field: keyof Contact, value: string) => {
    const updated = [...contacts];
    updated[index] = { ...updated[index], [field]: value };
    setContacts(updated);
  };

  const removeContact = (index: number) => {
    setContacts(contacts.filter((_, i) => i !== index));
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" /> Company Profile
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your company details, SAP landscape, and team contacts</p>
      </div>

      {/* Company Overview */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" /> Company Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Logo upload */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Avatar className="w-20 h-20 rounded-xl border-2 border-border/50">
                <AvatarImage src={logoUrl || undefined} alt="Company logo" className="object-cover" />
                <AvatarFallback className="rounded-xl bg-primary/10 text-primary text-lg font-bold">
                  {companyName ? companyName.charAt(0).toUpperCase() : <Building2 className="w-8 h-8" />}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={requestLogoSelect}
                disabled={uploadingLogo}
                className="absolute inset-0 rounded-xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
              >
                {uploadingLogo ? (
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                ) : (
                  <Camera className="w-5 h-5 text-white" />
                )}
              </button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleLogoUpload}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{t('company_profile_page.company_logo', 'Company Logo')}</p>
              <p className="text-xs text-muted-foreground">{t('company_profile_page.logo_hint', 'Click to upload. Max 5MB, JPG/PNG.')}</p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={requestLogoSelect}
                  disabled={uploadingLogo}
                >
                  {uploadingLogo ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" />
                      Uploading… {logoUploadProgress}%
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5 me-1.5" />
                      {logoUrl ? 'Replace logo' : 'Upload logo'}
                    </>
                  )}
                </Button>
              </div>
              {uploadingLogo && (
                <Progress value={logoUploadProgress} className="mt-2 h-1.5 max-w-xs" />
              )}
            </div>
          </div>

          {/* Confirm replace dialog — only shown when a logo already exists */}
          <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace company logo?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will replace the current logo for everyone in your company. The change cannot be undone, but you can upload a new logo at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
                <Avatar className="w-14 h-14 rounded-lg border border-border/50">
                  <AvatarImage src={logoUrl || undefined} alt="Current company logo" className="object-cover" />
                  <AvatarFallback className="rounded-lg bg-primary/10 text-primary font-bold">
                    {companyName ? companyName.charAt(0).toUpperCase() : <Building2 className="w-6 h-6" />}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Current logo</p>
                  <p className="text-sm font-medium text-foreground truncate">
                    {companyName || 'Your company'}
                  </p>
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmReplaceLogo}>
                  Choose new logo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('company_profile_page.company_name', 'Company Name')}</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp" />
            </div>
            <div className="space-y-2">
              <Label>{t('company_profile_page.industry', 'Industry')}</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger><SelectValue placeholder="Select industry..." /></SelectTrigger>
                <SelectContent>
                  {industries.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('company_profile_page.company_size', 'Company Size')}</Label>
              <Select value={companySize} onValueChange={setCompanySize}>
                <SelectTrigger><SelectValue placeholder="Select size..." /></SelectTrigger>
                <SelectContent>
                  {companySizes.map(s => <SelectItem key={s} value={s}>{s} employees</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {t('company_profile_page.headquarters', 'Headquarters')}</Label>
              <Input value={headquarters} onChange={(e) => setHeadquarters(e.target.value)} placeholder="Riyadh, Saudi Arabia" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> {t('company_profile_page.website', 'Website')}</Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://acme.com" type="url" />
          </div>
          <div className="space-y-2">
            <Label>{t('company_profile_page.company_description', 'Company Description')}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief overview of your company..." rows={3} />
          </div>
        </CardContent>
      </Card>

      {/* SAP Landscape */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" /> {t('company_profile_page.sap_landscape_title', 'SAP Landscape')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('company_profile_page.sap_landscape_desc', 'SAP Landscape Description')}</Label>
              <Input value={sapLandscape} onChange={(e) => setSapLandscape(e.target.value)} placeholder="S/4HANA 2023, ECC 6.0..." />
            </div>
            <div className="space-y-2">
              <Label>{t('company_profile_page.hosting_type', 'Hosting Type')}</Label>
              <Select value={sapHostingType} onValueChange={setSapHostingType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on-prem">{t('company_profile_page.hosting_on_prem', 'On-Premise')}</SelectItem>
                  <SelectItem value="cloud">{t('company_profile_page.hosting_cloud', 'Cloud (BTP/Rise)')}</SelectItem>
                  <SelectItem value="hybrid">{t('company_profile_page.hosting_hybrid', 'Hybrid')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Server className="w-3.5 h-3.5" /> System IDs</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {sapSystemIds.map((sid) => (
                <Badge key={sid} variant="secondary" className="gap-1 text-xs">
                  {sid}
                  <button onClick={() => setSapSystemIds(sapSystemIds.filter(s => s !== sid))} className="hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newSystemId}
                onChange={(e) => setNewSystemId(e.target.value)}
                placeholder="e.g., DEV, QAS, PRD"
                className="max-w-xs"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSystemId())}
              />
              <Button variant="outline" size="sm" onClick={addSystemId}>
                <Plus className="w-3.5 h-3.5 me-1" /> Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Details */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" /> System Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><Package className="w-3.5 h-3.5" /> SAP Product</Label>
              <Select value={sapProduct} onValueChange={setSapProduct}>
                <SelectTrigger><SelectValue placeholder="Select product..." /></SelectTrigger>
                <SelectContent>
                  {['S/4HANA', 'S/4HANA Cloud', 'ECC 6.0', 'SAP BW/4HANA', 'SAP BW on HANA', 'SAP CRM', 'SAP SRM', 'SAP SCM', 'SAP GTS', 'SAP Solution Manager', 'SAP BTP', 'SAP SuccessFactors', 'SAP Ariba', 'SAP Concur', 'Other'].map(p => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Version / Release</Label>
              <Input value={sapVersion} onChange={e => setSapVersion(e.target.value)} placeholder="e.g., 2023 FPS01, EHP8" maxLength={50} />
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><HardDrive className="w-3.5 h-3.5" /> Database</Label>
              <Select value={sapDatabaseType} onValueChange={setSapDatabaseType}>
                <SelectTrigger><SelectValue placeholder="Select database..." /></SelectTrigger>
                <SelectContent>
                  {['SAP HANA', 'SAP HANA Cloud', 'Oracle', 'Microsoft SQL Server', 'IBM DB2', 'SAP ASE (Sybase)', 'SAP MaxDB', 'Other'].map(d => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Operating System</Label>
              <Select value={sapOsType} onValueChange={setSapOsType}>
                <SelectTrigger><SelectValue placeholder="Select OS..." /></SelectTrigger>
                <SelectContent>
                  {['SUSE Linux (SLES)', 'Red Hat Enterprise Linux', 'Windows Server', 'IBM AIX', 'HP-UX', 'Oracle Solaris', 'Cloud-managed', 'Other'].map(o => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Support Pack Level</Label>
              <Input value={sapSupportPack} onChange={e => setSapSupportPack(e.target.value)} placeholder="e.g., SP05" maxLength={20} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Go-Live Date</Label>
              <Input type="date" value={sapGoLiveDate} onChange={e => setSapGoLiveDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><Users2 className="w-3.5 h-3.5" /> Active Users</Label>
              <Input type="number" min={0} value={sapUserCount} onChange={e => setSapUserCount(e.target.value ? Number(e.target.value) : '')} placeholder="e.g., 500" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Code className="w-3.5 h-3.5" /> Custom Developments (Z/Y Objects)</Label>
            <Input type="number" min={0} value={sapCustomDevCount} onChange={e => setSapCustomDevCount(e.target.value ? Number(e.target.value) : '')} placeholder="Approximate count" className="max-w-xs" />
          </div>
        </CardContent>
      </Card>

      {/* Integrations & Tools */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" /> Integrations & Third-Party Tools
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Interfaces / Middleware</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {sapInterfaces.map(i => (
                <Badge key={i} variant="secondary" className="gap-1 text-xs">
                  {i}
                  <button onClick={() => setSapInterfaces(sapInterfaces.filter(x => x !== i))} className="hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newInterface} onChange={e => setNewInterface(e.target.value)} placeholder="e.g., SAP PI/PO, MuleSoft, Dell Boomi" className="max-w-xs" maxLength={60}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newInterface.trim() && !sapInterfaces.includes(newInterface.trim())) { setSapInterfaces([...sapInterfaces, newInterface.trim()]); setNewInterface(''); } } }} />
              <Button variant="outline" size="sm" onClick={() => { if (newInterface.trim() && !sapInterfaces.includes(newInterface.trim())) { setSapInterfaces([...sapInterfaces, newInterface.trim()]); setNewInterface(''); } }}>
                <Plus className="w-3.5 h-3.5 me-1" /> Add
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Third-Party Tools</Label>
            <div className="flex flex-wrap gap-2 mb-2">
              {sapThirdPartyTools.map(t => (
                <Badge key={t} variant="secondary" className="gap-1 text-xs">
                  {t}
                  <button onClick={() => setSapThirdPartyTools(sapThirdPartyTools.filter(x => x !== t))} className="hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newTool} onChange={e => setNewTool(e.target.value)} placeholder="e.g., OpenText, Fiori Launchpad, BOBJ" className="max-w-xs" maxLength={60}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (newTool.trim() && !sapThirdPartyTools.includes(newTool.trim())) { setSapThirdPartyTools([...sapThirdPartyTools, newTool.trim()]); setNewTool(''); } } }} />
              <Button variant="outline" size="sm" onClick={() => { if (newTool.trim() && !sapThirdPartyTools.includes(newTool.trim())) { setSapThirdPartyTools([...sapThirdPartyTools, newTool.trim()]); setNewTool(''); } }}>
                <Plus className="w-3.5 h-3.5 me-1" /> Add
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Landscape Notes</Label>
            <Textarea value={sapLandscapeNotes} onChange={e => setSapLandscapeNotes(e.target.value)} placeholder="Any additional notes about your system landscape, architecture, or special configurations..." rows={3} maxLength={2000} />
          </div>
        </CardContent>
      </Card>

      {/* Key Contacts */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users2 className="w-4 h-4 text-primary" /> Key Contacts
          </CardTitle>
          <Button variant="outline" size="sm" onClick={addContact} className="gap-1">
            <Plus className="w-3.5 h-3.5" /> Add Contact
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No team contacts added yet</p>
          ) : (
            contacts.map((contact, i) => (
              <div key={i} className="p-4 rounded-xl border border-border/30 bg-muted/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Contact #{i + 1}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeContact(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={contact.name} onChange={(e) => updateContact(i, 'name', e.target.value)} placeholder="John Doe" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1"><Briefcase className="w-3 h-3" /> Role</Label>
                    <Input value={contact.role} onChange={(e) => updateContact(i, 'role', e.target.value)} placeholder="SAP Basis Admin" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1"><Mail className="w-3 h-3" /> Email</Label>
                    <Input value={contact.email} onChange={(e) => updateContact(i, 'email', e.target.value)} placeholder="john@acme.com" type="email" className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> Phone</Label>
                    <Input value={contact.phone} onChange={(e) => updateContact(i, 'phone', e.target.value)} placeholder="+966 5XX..." className="h-8 text-sm" />
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={updateProfile.isPending} className="gradient-primary border-0 gap-2">
          {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Company Profile
        </Button>
      </div>
    </div>
  );
}
