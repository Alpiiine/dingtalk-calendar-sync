// Form controls: Animate UI's Radix primitives (the check draws itself, the thumb and the dot
// move on springs), dressed in this page's colours.
import type { ComponentProps } from 'react';
import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive, RadioGroup as RadioGroupPrimitive, Switch as SwitchPrimitive } from '@animate-ui/react/primitives/radix-ui';
import { cn } from '../lib/cn';

const BOX = 'relative flex size-5 shrink-0 items-center justify-center border-[1.5px] border-edge bg-surface text-on-accent shadow-ctl transition-colors duration-150 pointer-fine:size-[1.125rem] '
  + 'before:absolute before:-inset-px before:rounded-[inherit] before:bg-accent before:opacity-0 before:scale-70 before:transition-[scale,opacity] before:duration-150 '
  + 'motion-reduce:before:scale-100 data-[state=checked]:border-accent data-[state=checked]:before:opacity-100 data-[state=checked]:before:scale-100 '
  + 'disabled:opacity-55';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root className={cn(BOX, 'rounded-[.35rem]', className)} {...props}>
      <CheckboxPrimitive.Indicator className="relative grid place-content-center text-current [&>svg]:size-3.5 pointer-fine:[&>svg]:size-3">
        <Check strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn('relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent bg-edge transition-colors duration-150 data-[state=checked]:bg-accent data-[disabled]:opacity-55', className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 translate-x-px rounded-full bg-on-accent shadow-[0_1px_2px_rgba(15,23,42,.25)] data-[state=checked]:translate-x-[17px]" />
    </SwitchPrimitive.Root>
  );
}

export const RadioGroup = RadioGroupPrimitive.Root;

export function RadioItem({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item className={cn(BOX, 'rounded-full', className)} {...props}>
      <RadioGroupPrimitive.Indicator className="flex size-full items-center justify-center">
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-on-accent" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}
