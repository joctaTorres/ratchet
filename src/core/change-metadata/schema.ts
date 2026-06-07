import { z } from 'zod';

// Per-change metadata schema. The schema field is validated against available
// workflow schemas when metadata is read or written.
export const ChangeMetadataSchema = z.object({
  schema: z.string().min(1, { message: 'schema is required' }),
  created: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: 'created must be YYYY-MM-DD format',
    })
    .optional(),
  // Standard tags the change follows. Each tag resolves to a standard in
  // `.ratchet/standards/`; validation reports any tag that does not. Optional so
  // a change may follow no particular standard.
  standards: z.array(z.string().min(1)).optional(),
});

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>;
