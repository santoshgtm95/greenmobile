import { Box } from '@mui/material';
import { LOGO_DATA_URI } from '@shared/logo';

/**
 * The shop mark.
 *
 * WHY THE `onDark` VARIANT EXISTS
 *
 * The logo is two-tone: a green "G" and a dark grey "M", drawn for a light
 * background. Measured against the navy sidebar (#0f1b2d) the grey half comes out
 * at 3.3:1 — technically above the 3:1 floor for a graphical object, but at 28px
 * the M and the surrounding circle strokes visibly disappear and the mark reads
 * as "G" rather than "GM".
 *
 * So on dark surfaces it sits on a light tile instead of being recoloured or
 * quietly accepted. Recolouring someone's logo is not ours to do, and shipping a
 * mark that loses half its letters is worse than spending a few pixels on a
 * backing.
 */
export default function Logo({
  size = 40,
  onDark = false,
}: {
  size?: number;
  /** Places the mark on a light tile, for the navy sidebar. */
  onDark?: boolean;
}) {
  const image = (
    <Box
      component="img"
      src={LOGO_DATA_URI}
      alt=""
      /* Decorative: every place this appears already names the shop in text. */
      aria-hidden
      sx={{ width: size, height: size, display: 'block', objectFit: 'contain' }}
    />
  );

  if (!onDark) return image;

  return (
    <Box
      sx={{
        p: 0.75,
        borderRadius: 1.5,
        bgcolor: 'common.white',
        display: 'inline-flex',
        flexShrink: 0,
        lineHeight: 0,
      }}
    >
      {image}
    </Box>
  );
}
