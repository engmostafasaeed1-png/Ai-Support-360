import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import CityPicker from '@/components/consultant/onboarding/steps/CityPicker';
import { COUNTRIES, citiesOf } from '@/lib/geo';
import { resolvePlacePoint } from '@/lib/consultantLocation';

export interface PickedLocation { country: string; city: string }

interface Props {
  value: PickedLocation;
  onChange: (next: PickedLocation) => void;
  error?: string | null;
  idPrefix?: string;
}

/**
 * Searchable country and city picker. The map point comes from the same place list the map uses:
 * the city centre, or the country centre for a city typed by hand. Only city level is stored.
 */
export default function LocationPicker({ value, onChange, error, idPrefix = 'loc' }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const point = resolvePlacePoint(value.country, value.city);
  const errorId = `${idPrefix}-error`;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label id={`${idPrefix}-country-label`}>{t('location.country', 'Country')} <span aria-hidden="true" className="text-destructive">*</span></Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" role="combobox" aria-expanded={open} aria-labelledby={`${idPrefix}-country-label`}
                aria-invalid={!!error && !value.country} aria-describedby={error ? errorId : undefined} className="w-full justify-between font-normal">
                <span className="truncate">{value.country || t('location.select_country', 'Select country')}</span>
                <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder={t('location.search_country', 'Search country')} />
                <CommandList>
                  <CommandEmpty>{t('location.no_country', 'No country found.')}</CommandEmpty>
                  <CommandGroup>
                    {COUNTRIES.map(c => (
                      <CommandItem key={c} value={c} onSelect={() => { onChange({ country: c, city: c === value.country ? value.city : '' }); setOpen(false); }}>{c}</CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-1.5">
          <Label>{t('location.city', 'City')} <span aria-hidden="true" className="text-destructive">*</span></Label>
          <CityPicker country={value.country} city={value.city} cities={value.country ? citiesOf(value.country) : []} onChange={city => onChange({ ...value, city })} />
        </div>
      </div>
      {point && value.city.trim() && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="location-point-note">
          <MapPin aria-hidden="true" className="h-3 w-3 shrink-0" />
          {point.source === 'city'
            ? t('location.pin_city', 'Your map pin is the centre of {{city}}. Clients see the city, never an address.', { city: value.city })
            : t('location.pin_country', 'This city is not in our list, so your map pin is the centre of {{country}}.', { country: value.country })}
        </p>
      )}
      {error && <p id={errorId} role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
