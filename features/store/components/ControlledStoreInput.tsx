"use client"

import { useController, type FieldPathByValue } from "react-hook-form"

import { Input } from "@/components/ui/input"
import type { StoreFormValues } from "@/features/store/types/store.types"

type StoreTextFieldPath = FieldPathByValue<StoreFormValues, string>

type ControlledStoreInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "defaultValue" | "name" | "onBlur" | "onChange" | "ref" | "value"
> & {
  readonly name: StoreTextFieldPath
}

/**
 * Controlled text/number input for the store form. Keeping the value explicit
 * ensures saved data is visible when the same form is opened in edit mode.
 */
export function ControlledStoreInput({
  name,
  ...props
}: ControlledStoreInputProps) {
  const { field } = useController<StoreFormValues, StoreTextFieldPath>({ name })

  return <Input {...props} {...field} value={field.value ?? ""} />
}
