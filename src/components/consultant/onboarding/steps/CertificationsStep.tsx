import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, Award, Upload } from 'lucide-react';
import type { OnboardingData } from '../ConsultantOnboarding';

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
}

export default function CertificationsStep({ data, onChange }: Props) {
  const { t } = useTranslation();

  const addCert = () => {
    onChange({
      certifications: [...data.certifications, { name: '', issuer: '', issueDate: '', expiryDate: '' }],
    });
  };

  const updateCert = (idx: number, partial: Partial<OnboardingData['certifications'][0]>) => {
    const updated = data.certifications.map((c, i) => (i === idx ? { ...c, ...partial } : c));
    onChange({ certifications: updated });
  };

  const removeCert = (idx: number) => {
    onChange({ certifications: data.certifications.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{t('onboarding.certifications')}</h3>
          <p className="text-xs text-muted-foreground">{t('onboarding.certifications_desc')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={addCert} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          {t('onboarding.add_cert')}
        </Button>
      </div>

      {data.certifications.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <Award className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">{t('onboarding.no_certs')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('onboarding.certs_optional')}</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.certifications.map((cert, idx) => (
            <Card key={idx} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('onboarding.cert_name')} *</Label>
                    <Input
                      value={cert.name}
                      onChange={e => updateCert(idx, { name: e.target.value })}
                      placeholder="SAP S/4HANA Associate"
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('onboarding.cert_issuer')}</Label>
                    <Input
                      value={cert.issuer}
                      onChange={e => updateCert(idx, { issuer: e.target.value })}
                      placeholder="SAP SE"
                      maxLength={200}
                    />
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive h-8 w-8" onClick={() => removeCert(idx)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('onboarding.issue_date')}</Label>
                  <Input type="date" value={cert.issueDate} onChange={e => updateCert(idx, { issueDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('onboarding.expiry_date')}</Label>
                  <Input type="date" value={cert.expiryDate} onChange={e => updateCert(idx, { expiryDate: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('onboarding.upload_cert')}</Label>
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {cert.file ? cert.file.name : t('onboarding.choose_file')}
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) updateCert(idx, { file });
                    }}
                  />
                </label>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
