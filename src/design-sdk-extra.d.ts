declare module '@faclon-labs/design-sdk/UNSPathInput' {
  import type { FC, FocusEvent } from 'react';

  type UNSTree = { [key: string]: UNSTree | null };

  export interface UNSPathInputProps {
    label?: string;
    placeholder?: string;
    value: string;
    tree?: UNSTree;
    isLoading?: boolean;
    onChange: (value: string) => void;
    /** Forwarded to the underlying textarea — fires BEFORE the SDK's own commit logic. */
    onBlur?: (e: FocusEvent<HTMLTextAreaElement>) => void;
    onOpen?: () => void;
  }

  export const UNSPathInput: FC<UNSPathInputProps>;
}
