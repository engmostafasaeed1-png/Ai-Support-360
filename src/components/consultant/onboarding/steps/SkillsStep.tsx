import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { Plus, Trash2, Cpu } from 'lucide-react';
import type { OnboardingData } from '../ConsultantOnboarding';

const sapModules = [
  'S/4HANA', 'SAP MM', 'SAP SD', 'SAP FI', 'SAP CO', 'SAP PP', 'SAP QM',
  'SAP WM', 'SAP HCM', 'SAP PM', 'SAP PS', 'SAP BW', 'SAP ABAP',
  'SAP Basis', 'SAP BTP', 'SuccessFactors', 'SAP Ariba', 'SAP CPI',
  'SAP EWM', 'SAP TM', 'SAP IS-Oil', 'SAP FICO',
];

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
}

export default function SkillsStep({ data, onChange }: Props) {
  const { t } = useTranslation();

  const addSkill = () => {
    onChange({
      skills: [...data.skills, { sapModule: '', proficiencyLevel: 3, yearsExperience: 1, certified: false }],
    });
  };

  const updateSkill = (idx: number, partial: Partial<OnboardingData['skills'][0]>) => {
    const updated = data.skills.map((s, i) => (i === idx ? { ...s, ...partial } : s));
    onChange({ skills: updated });
  };

  const removeSkill = (idx: number) => {
    onChange({ skills: data.skills.filter((_, i) => i !== idx) });
  };

  const usedModules = data.skills.map(s => s.sapModule);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{t('onboarding.sap_skills')}</h3>
          <p className="text-xs text-muted-foreground">{t('onboarding.sap_skills_desc')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={addSkill} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          {t('onboarding.add_skill')}
        </Button>
      </div>

      {data.skills.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <Cpu className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">{t('onboarding.no_skills')}</p>
          <Button variant="outline" size="sm" onClick={addSkill} className="mt-3 gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            {t('onboarding.add_first_skill')}
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.skills.map((skill, idx) => (
            <Card key={idx} className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('onboarding.sap_module')}</Label>
                    <Select value={skill.sapModule} onValueChange={v => updateSkill(idx, { sapModule: v })}>
                      <SelectTrigger><SelectValue placeholder={t('onboarding.select_module')} /></SelectTrigger>
                      <SelectContent>
                        {sapModules.filter(m => m === skill.sapModule || !usedModules.includes(m)).map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('onboarding.years_experience')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={30}
                      value={skill.yearsExperience}
                      onChange={e => updateSkill(idx, { yearsExperience: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive h-8 w-8" onClick={() => removeSkill(idx)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>{t('onboarding.proficiency')} ({skill.proficiencyLevel}/5)</Label>
                </div>
                <Slider
                  value={[skill.proficiencyLevel]}
                  onValueChange={([v]) => updateSkill(idx, { proficiencyLevel: v })}
                  min={1}
                  max={5}
                  step={1}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={skill.certified}
                  onCheckedChange={v => updateSkill(idx, { certified: v })}
                />
                <Label className="text-sm">{t('onboarding.sap_certified')}</Label>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
