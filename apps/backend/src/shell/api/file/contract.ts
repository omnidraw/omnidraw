import { pc } from '../procedure';
import { z } from 'zod';

const fileFormatSchema = z.union([
  z.literal('image/jpeg'),
  z.literal('image/png'),
  z.literal('image/gif'),
  z.literal('image/webp'),
]);

const putFileInputSchema = z.object({
  body: z.object({
    data: z.union([z.instanceof(Blob), z.instanceof(Uint8Array)]),
    mime_type: fileFormatSchema,
  }),
});

const putFileOutputSchema = z.object({
  url: z.string(),
});

const cloneFileInputSchema = z.object({
  body: z.object({
    url: z.string(),
  }),
});

const cloneFileOutputSchema = z.object({
  url: z.string(),
});

const removeFileInputSchema = z.object({
  body: z.object({
    url: z.string(),
  }),
});

const removeFileOutputSchema = z.object({
  ok: z.literal(true),
});

type TPutFileInput = z.infer<typeof putFileInputSchema>;
type TPutFileOutput = z.infer<typeof putFileOutputSchema>;
type TCloneFileInput = z.infer<typeof cloneFileInputSchema>;
type TCloneFileOutput = z.infer<typeof cloneFileOutputSchema>;
type TRemoveFileInput = z.infer<typeof removeFileInputSchema>;
type TRemoveFileOutput = z.infer<typeof removeFileOutputSchema>;
type TFileFormat = z.infer<typeof fileFormatSchema>;

const fileContract = pc.router({
  put: pc
    .input(putFileInputSchema)
    .output(putFileOutputSchema),
  clone: pc
    .input(cloneFileInputSchema)
    .output(cloneFileOutputSchema),
  remove: pc
    .input(removeFileInputSchema)
    .output(removeFileOutputSchema),
});

export { fileContract };
export type {
  TCloneFileInput,
  TCloneFileOutput,
  TFileFormat,
  TPutFileInput,
  TPutFileOutput,
  TRemoveFileInput,
  TRemoveFileOutput,
};
