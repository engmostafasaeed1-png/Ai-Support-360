import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Building2, Globe, MapPin, Save, Loader2, Plus, Trash2,
  Server, Database, Users2, Mail, Phone, Briefcase,
} from 'lucide-react';
import { useClientProfileData, useUpdateClientProfile, type ClientProfile } from '@/hooks/useClientProfile';
import { useGuestMode } from '@/contexts/GuestModeContext';
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (profile && !loaded) {
      setCompanyName(profile.company_name || '');
      setCompanySize(profile.company_size || '');
      setIndustry(profile.industry || '');
      setDescription((profile as any).company_description || '');
      setWebsite((profile as any).company_website || '');
      setHeadquarters((profile as any).headquarters || '');
      setSapLandscape(profile.sap_landscape || '');
      setSapHostingType((profile as any).sap_hosting_type || 'on-prem');
      setSapSystemIds((profile as any).sap_system_ids || []);
      setContacts(((profile as any).key_contacts || []) as Contact[]);
      setLoaded(true);
    }
  }, [profile, loaded]);

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
    } as any);
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
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp" />
            </div>
            <div className="space-y-2">
              <Label>Industry</Label>
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
              <Label>Company Size</Label>
              <Select value={companySize} onValueChange={setCompanySize}>
                <SelectTrigger><SelectValue placeholder="Select size..." /></SelectTrigger>
                <SelectContent>
                  {companySizes.map(s => <SelectItem key={s} value={s}>{s} employees</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Headquarters</Label>
              <Input value={headquarters} onChange={(e) => setHeadquarters(e.target.value)} placeholder="Riyadh, Saudi Arabia" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> Website</Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://acme.com" type="url" />
          </div>
          <div className="space-y-2">
            <Label>Company Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief overview of your company..." rows={3} />
          </div>
        </CardContent>
      </Card>

      {/* SAP Landscape */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" /> SAP Landscape
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SAP Landscape Description</Label>
              <Input value={sapLandscape} onChange={(e) => setSapLandscape(e.target.value)} placeholder="S/4HANA 2023, ECC 6.0..." />
            </div>
            <div className="space-y-2">
              <Label>Hosting Type</Label>
              <Select value={sapHostingType} onValueChange={setSapHostingType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="on-prem">On-Premise</SelectItem>
                  <SelectItem value="cloud">Cloud (BTP/Rise)</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
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
