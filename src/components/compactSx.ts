/** Smaller text for the Banking tabs' top buttons and filter bars, so every tab matches. */

/** The button row above the tabs; also reaches buttons nested in ExportMenu. */
export const compactToolbarSx = {
  '& .MuiButton-root': { fontSize: '0.8rem', py: 0.5 },
  '& .MuiButton-startIcon svg': { fontSize: 18 },
} as const;

/** The filter bar: inputs, their labels and switch labels. */
export const compactFiltersSx = {
  '& .MuiInputBase-root, & .MuiInputLabel-root, & .MuiFormControlLabel-label': { fontSize: '0.8rem' },
} as const;

/** A whole page (Reports, Settings): tabs, fields, headings and text. */
export const compactPageSx = {
  ...compactFiltersSx,
  '& .MuiTabs-root': { minHeight: 40 },
  '& .MuiTab-root': { fontSize: '0.8rem', minHeight: 40, py: 1 },
  '& .MuiTypography-h6': { fontSize: '1rem' },
  '& .MuiTypography-subtitle1': { fontSize: '0.85rem' },
  '& .MuiTypography-subtitle2': { fontSize: '0.78rem' },
  '& .MuiTypography-body1, & .MuiTypography-body2': { fontSize: '0.8rem' },
  '& .MuiTypography-caption, & .MuiFormHelperText-root': { fontSize: '0.68rem' },
} as const;
