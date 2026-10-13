import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

interface Props {
  country: string;
  city: string;
  cities: string[];
  onChange: (city: string) => void;
}

/** A searchable list of the known cities of the chosen country, with "Other city" for free text so nobody is blocked. */
export default function CityPicker({ country, city, cities, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState(false);
  const known = cities.includes(city);
  const freeText = other || (!!city && !known);

  if (freeText) {
    return (
      <div className="space-y-1">
        <Input
          value={city}
          onChange={e => onChange(e.target.value)}
          maxLength={80}
          placeholder={t('profileRules.otherCityPlaceholder', 'Type your city')}
          aria-label={t('profileRules.otherCity', 'Other city')}
        />
        {cities.length > 0 && (
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => { setOther(false); onChange(''); }}>
            {t('profileRules.pickFromList', 'Choose from the list')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} disabled={!country} className="w-full justify-between font-normal">
          <span className="truncate">{known ? city : country ? 'Select city' : 'Select country first'}</span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={t('profileRules.searchCity', 'Search city')} />
          <CommandList>
            <CommandEmpty>{t('profileRules.noCity', 'No city found.')}</CommandEmpty>
            <CommandGroup>
              {cities.map(c => (
                <CommandItem key={c} value={c} onSelect={() => { onChange(c); setOpen(false); }}>{c}</CommandItem>
              ))}
              <CommandItem value="__other__" onSelect={() => { setOther(true); onChange(''); setOpen(false); }}>
                {t('profileRules.otherCity', 'Other city')}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
