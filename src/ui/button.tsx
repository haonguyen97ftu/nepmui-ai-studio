import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { twMerge } from 'tailwind-merge'

const variants = cva('button', {
  variants: { variant: { primary: 'button-primary', outline: 'button-outline', ghost: 'button-ghost', danger: 'button-danger' } },
  defaultVariants: { variant: 'primary' },
})

export function Button({ className, variant, asChild, type = 'button', ...props }:
  ComponentProps<'button'> & VariantProps<typeof variants> & { asChild?: boolean }) {
  const style = twMerge(variants({ variant }), className)
  if (asChild) return <Slot className={style} {...props} />
  return <button type={type} className={style} {...props} />
}
