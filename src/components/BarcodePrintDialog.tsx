import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PrintIcon from '@mui/icons-material/Print';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import JsBarcode from 'jsbarcode';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMoneyFormatter } from '../hooks/useSettings';
import { generateEan13Candidate, isValidEan13 } from '@shared/barcode';
import type { Product } from '@shared/api';

/**
 * Renders a single crisp SVG barcode using JsBarcode.
 */
export function BarcodeSvg({
  value,
  width = 1.6,
  height = 42,
  fontSize = 12,
}: {
  value: string;
  width?: number;
  height?: number;
  fontSize?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        const format = isValidEan13(value) ? 'EAN13' : 'CODE128';
        JsBarcode(svgRef.current, value, {
          format,
          width,
          height,
          displayValue: true,
          fontSize,
          margin: 4,
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch {
        // Fall back to CODE128 if EAN13 throws on non-standard digits
        try {
          if (svgRef.current) {
            JsBarcode(svgRef.current, value, {
              format: 'CODE128',
              width,
              height,
              displayValue: true,
              fontSize,
              margin: 4,
              background: '#ffffff',
              lineColor: '#000000',
            });
          }
        } catch (fallbackErr) {
          console.error('Barcode generation error:', fallbackErr);
        }
      }
    }
  }, [value, width, height, fontSize]);

  return (
    <svg
      ref={svgRef}
      style={{
        display: 'block',
        maxWidth: '100%',
        height: 'auto',
      }}
    />
  );
}

/**
 * Dialog to view and print barcode labels for a product.
 * Supports entering a count to preview and print multiple labels.
 */
export default function BarcodePrintDialog({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const money = useMoneyFormatter();
  const queryClient = useQueryClient();
  const [currentProduct, setCurrentProduct] = useState<Product>(product);
  const [count, setCount] = useState<number>(1);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const templateSvgRef = useRef<HTMLDivElement>(null);

  const barcodeValue = currentProduct.barcode?.trim() ?? '';

  // Mutation to generate and assign a barcode if this product doesn't have one yet
  const assignBarcode = useMutation({
    mutationFn: async () => {
      const newBarcode = generateEan13Candidate();
      const updated = await api.products.update({
        id: currentProduct.id,
        sku: currentProduct.sku,
        barcode: newBarcode,
        name: currentProduct.name,
        description: currentProduct.description ?? undefined,
        categoryId: currentProduct.categoryId ?? undefined,
        brandId: currentProduct.brandId ?? undefined,
        purchasePrice: currentProduct.purchasePrice,
        sellingPrice: currentProduct.sellingPrice,
        taxRate: currentProduct.taxRate,
        taxRateOverride: currentProduct.taxRateOverride === 1,
        minimumStock: currentProduct.minimumStock,
        unit: currentProduct.unit,
        isSerialized: currentProduct.isSerialized === 1,
        warrantyMonths: currentProduct.warrantyMonths,
        isActive: currentProduct.isActive === 1,
      });
      return updated;
    },
    onSuccess: (updated) => {
      setCurrentProduct(updated);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: () => {
      setError('Unable to assign barcode.');
    },
  });

  const handleCountChange = (val: string) => {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed) || parsed < 1) {
      setCount(1);
    } else {
      setCount(Math.min(parsed, 500));
    }
  };

  const handlePrint = () => {
    if (!barcodeValue) return;
    setIsPrinting(true);

    try {
      const svgElement = templateSvgRef.current?.querySelector('svg');
      const svgMarkup = svgElement ? svgElement.outerHTML : '';

      const brandText = currentProduct.brandName ? ` · ${currentProduct.brandName}` : '';
      const subInfo = `${currentProduct.sku}${brandText}`;
      const priceText = money(currentProduct.sellingPrice);

      let labelsHtml = '';
      for (let i = 0; i < count; i++) {
        labelsHtml += `
          <div class="barcode-label">
            <div class="product-name">${escapeHtml(currentProduct.name)}</div>
            <div class="barcode-graphic">${svgMarkup}</div>
            <div class="label-footer">
              <span class="sub-info">${escapeHtml(subInfo)}</span>
              <span class="price">${escapeHtml(priceText)}</span>
            </div>
          </div>
        `;
      }

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) {
        document.body.removeChild(iframe);
        setIsPrinting(false);
        return;
      }

      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Barcode - ${escapeHtml(currentProduct.name)}</title>
            <style>
              @page {
                size: auto;
                margin: 4mm;
              }
              * {
                box-sizing: border-box;
              }
              body {
                margin: 0;
                padding: 0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                background: #ffffff;
                color: #000000;
              }
              .labels-grid {
                display: flex;
                flex-wrap: wrap;
                gap: 4mm;
                align-items: flex-start;
              }
              .barcode-label {
                width: 48mm;
                height: 28mm;
                border: 1px dashed #777;
                padding: 1.5mm 2.5mm;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                align-items: center;
                text-align: center;
                page-break-inside: avoid;
                background: #fff;
              }
              .product-name {
                font-size: 8.5pt;
                font-weight: 700;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                width: 100%;
                line-height: 1.2;
              }
              .barcode-graphic {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                max-height: 15mm;
              }
              .barcode-graphic svg {
                max-width: 100%;
                height: auto;
                max-height: 14mm;
              }
              .label-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
                font-size: 7.5pt;
                line-height: 1;
              }
              .sub-info {
                color: #333;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 60%;
              }
              .price {
                font-weight: 700;
                color: #000;
              }
              @media print {
                .barcode-label {
                  border: 1px solid #000;
                }
              }
            </style>
          </head>
          <body>
            <div class="labels-grid">
              ${labelsHtml}
            </div>
          </body>
        </html>
      `);
      doc.close();

      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch {
            // Already removed
          }
          setIsPrinting(false);
        }, 1200);
      }, 300);
    } catch (err) {
      console.error('Print failed:', err);
      setError('Unable to print barcodes.');
      setIsPrinting(false);
    }
  };

  const countOptions = [1, 2, 4, 8, 12, 24];

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle sx={{ m: 0, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700 }}>
          Barcode — {currentProduct.name}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 2.5 }}>
        <Stack spacing={2.5}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Product and Barcode Summary Card */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              bgcolor: 'background.default',
              borderRadius: 1.5,
            }}
          >
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {currentProduct.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  SKU: <strong>{currentProduct.sku}</strong>
                  {currentProduct.brandName ? ` · Brand: ${currentProduct.brandName}` : ''}
                  {currentProduct.categoryName ? ` · Category: ${currentProduct.categoryName}` : ''}
                </Typography>
              </Box>
              <Box sx={{ textAlign: { sm: 'right' } }}>
                <Typography variant="caption" color="text.secondary">
                  Price
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main', fontVariantNumeric: 'tabular-nums' }}>
                  {money(currentProduct.sellingPrice)}
                </Typography>
              </Box>
            </Stack>

            <Divider sx={{ my: 1.5 }} />

            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                Barcode:
              </Typography>
              {barcodeValue ? (
                <Chip
                  label={barcodeValue}
                  variant="outlined"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: 1,
                  }}
                />
              ) : (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" color="warning.main" sx={{ fontStyle: 'italic' }}>
                    No barcode assigned
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AutoFixHighIcon fontSize="small" />}
                    onClick={() => assignBarcode.mutate()}
                    disabled={assignBarcode.isPending}
                  >
                    Generate & Assign
                  </Button>
                </Stack>
              )}
            </Stack>
          </Paper>

          {barcodeValue && (
            <>
              {/* Hidden template for SVG extraction */}
              <Box ref={templateSvgRef} sx={{ position: 'absolute', opacity: 0, pointerEvents: 'none', left: -9999 }}>
                <BarcodeSvg value={barcodeValue} width={1.8} height={42} />
              </Box>

              {/* Print count input and quick selection */}
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    <TextField
                      label="Barcode count to print"
                      type="number"
                      size="small"
                      value={count}
                      onChange={(e) => handleCountChange(e.target.value)}
                      slotProps={{
                        input: {
                          inputProps: { min: 1, max: 500 },
                          endAdornment: <InputAdornment position="end">copies</InputAdornment>,
                        },
                      }}
                      sx={{ width: 220 }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      Showing <strong>{count}</strong> {count === 1 ? 'label' : 'labels'} below
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                      Presets:
                    </Typography>
                    {countOptions.map((opt) => (
                      <Chip
                        key={opt}
                        label={opt}
                        size="small"
                        clickable
                        color={count === opt ? 'primary' : 'default'}
                        variant={count === opt ? 'filled' : 'outlined'}
                        onClick={() => setCount(opt)}
                      />
                    ))}
                  </Stack>
                </Stack>
              </Paper>

              {/* Barcode Labels Preview ("Show Them") */}
              <Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Preview
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    (How labels will print on 48mm × 28mm stickers or A4 paper)
                  </Typography>
                </Stack>

                <Box
                  sx={{
                    p: 2,
                    maxHeight: 380,
                    overflowY: 'auto',
                    bgcolor: 'action.hover',
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 2,
                      justifyContent: 'flex-start',
                    }}
                  >
                    {Array.from({ length: count }).map((_, idx) => (
                      <Box
                        key={idx}
                        sx={{
                          width: 200,
                          height: 125,
                          p: 1.2,
                          bgcolor: '#ffffff',
                          color: '#000000',
                          border: '1px dashed #aaa',
                          borderRadius: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          boxShadow: 1,
                          position: 'relative',
                        }}
                      >
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{
                            fontWeight: 700,
                            fontSize: '0.75rem',
                            textAlign: 'center',
                            width: '100%',
                            color: '#000',
                          }}
                        >
                          {currentProduct.name}
                        </Typography>

                        <Box sx={{ width: '100%', display: 'flex', justifyContent: 'center', my: 0.5 }}>
                          <BarcodeSvg value={barcodeValue} width={1.4} height={36} fontSize={11} />
                        </Box>

                        <Stack
                          direction="row"
                          sx={{
                            width: '100%',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '0.7rem',
                            lineHeight: 1,
                          }}
                        >
                          <Typography
                            variant="caption"
                            noWrap
                            sx={{
                              maxWidth: '65%',
                              fontSize: '0.68rem',
                              color: '#333',
                            }}
                          >
                            {currentProduct.sku}
                            {currentProduct.brandName ? ` · ${currentProduct.brandName}` : ''}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 700,
                              fontSize: '0.72rem',
                              color: '#000',
                            }}
                          >
                            {money(currentProduct.sellingPrice)}
                          </Typography>
                        </Stack>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit">
          Close
        </Button>
        {barcodeValue && (
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            onClick={handlePrint}
            disabled={isPrinting}
          >
            {isPrinting ? 'Preparing…' : `Print ${count} Barcode${count > 1 ? 's' : ''}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
