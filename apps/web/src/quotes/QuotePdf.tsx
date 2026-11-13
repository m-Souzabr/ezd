/* eslint-disable react-refresh/only-export-components -- Its components render into a PDF, never into the page. */
import { type BomUnit, formatMoney, formatQuantity } from '@ezd/core';
import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import robotoBold from 'roboto-fontface/fonts/roboto/Roboto-Bold.woff?url';
import robotoRegular from 'roboto-fontface/fonts/roboto/Roboto-Regular.woff?url';

import type { Quote } from '../api/client';
import { formatPercent, quoteDate, sizeText } from './format';

// The quote as a Letter-size PDF, drawn from the stored quote alone: nothing here reads
// the editor, the catalog or the clock. The font is embedded, and the PDF's own dates
// are the quote's, so the same quote always gives the same file.

const FONT = 'Roboto';
Font.register({
  family: FONT,
  fonts: [
    { src: robotoRegular, fontWeight: 400 },
    { src: robotoBold, fontWeight: 700 },
  ],
});
// Words are not split across lines.
Font.registerHyphenationCallback((word) => [word]);

const INK = '#0f172a';
const MUTED = '#475569';
const RULE = '#cbd5e1';

const styles = StyleSheet.create({
  page: {
    fontFamily: FONT,
    fontSize: 9,
    color: INK,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: 700 },
  muted: { color: MUTED },
  label: { color: MUTED, fontSize: 8, marginBottom: 2 },
  heading: { fontSize: 11, fontWeight: 700, marginTop: 14, marginBottom: 6 },
  drawing: { width: '100%', objectFit: 'contain', borderWidth: 0.5, borderColor: RULE },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
    paddingVertical: 3,
  },
  headRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 3,
    fontWeight: 700,
  },
  qty: { width: '9%', textAlign: 'right', paddingRight: 6 },
  description: { width: '33%', paddingRight: 6 },
  size: { width: '20%', paddingRight: 6 },
  finish: { width: '14%', paddingRight: 6 },
  money: { width: '12%', textAlign: 'right' },
  totals: { marginTop: 10, marginLeft: 'auto', width: '45%' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: INK,
    marginTop: 3,
    paddingTop: 4,
    fontSize: 11,
    fontWeight: 700,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: MUTED,
  },
});

const UNIT: Record<BomUnit, string> = { each: '', sqft: ' sq ft' };

function Totals({ quote }: { quote: Quote }) {
  const { totals, settings } = quote;
  const rows: [string, number][] = [['Subtotal', totals.subtotalCents]];
  if (settings.markupBps > 0)
    rows.push([`Markup ${formatPercent(settings.markupBps)}%`, totals.markupCents]);
  if (settings.discountBps > 0) {
    rows.push([`Discount ${formatPercent(settings.discountBps)}%`, -totals.discountCents]);
  }
  if (settings.taxBps > 0) {
    rows.push([`Taxable`, totals.taxableCents]);
    rows.push([`Tax ${formatPercent(settings.taxBps)}%`, totals.taxCents]);
  }
  return (
    <View style={styles.totals} wrap={false}>
      {rows.map(([name, cents]) => (
        <View key={name} style={styles.totalRow}>
          <Text>{name}</Text>
          <Text>{formatMoney(cents)}</Text>
        </View>
      ))}
      <View style={styles.grandTotal}>
        <Text>Total</Text>
        <Text>{formatMoney(totals.totalCents)}</Text>
      </View>
    </View>
  );
}

/** The PDF document of a quote, ready for `pdf()`. */
export function quoteDocument(quote: Quote) {
  const date = new Date(quote.created_at);
  const title = `Quote ${quote.number}`;
  return (
    <Document
      title={`${title}, ${quote.project_name}`}
      author="EZDesign"
      creator="EZDesign"
      producer="EZDesign"
      creationDate={date}
      modificationDate={date}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.muted}>
              {quote.project_name} · {quote.design_name}
            </Text>
            <Text style={styles.muted}>{quoteDate(quote.created_at)}</Text>
          </View>
          <View style={{ width: '45%' }}>
            <Text style={styles.label}>Prepared for</Text>
            <Text style={{ fontWeight: 700 }}>{quote.customer_name}</Text>
            {quote.customer_email !== '' && <Text>{quote.customer_email}</Text>}
            {quote.customer_address !== '' && <Text>{quote.customer_address}</Text>}
          </View>
        </View>

        <Text style={styles.heading}>Plan</Text>
        <Image style={styles.drawing} src={quote.drawings.plan} />

        <Text style={styles.heading}>Bill of materials</Text>
        <View style={styles.headRow}>
          <Text style={styles.qty}>Qty</Text>
          <Text style={styles.description}>Description</Text>
          <Text style={styles.size}>W x H x D</Text>
          <Text style={styles.finish}>Finish</Text>
          <Text style={styles.money}>Unit price</Text>
          <Text style={styles.money}>Total</Text>
        </View>
        {quote.lines.map((line) => (
          <View key={line.key} style={styles.row} wrap={false}>
            <Text style={styles.qty}>
              {formatQuantity(line)}
              {UNIT[line.unit]}
            </Text>
            <Text style={styles.description}>{line.description}</Text>
            <Text style={styles.size}>{sizeText(line)}</Text>
            <Text style={styles.finish}>{line.finishName}</Text>
            <Text style={styles.money}>{formatMoney(line.unitPriceCents)}</Text>
            <Text style={styles.money}>{formatMoney(line.lineTotalCents)}</Text>
          </View>
        ))}
        <Totals quote={quote} />

        {quote.notes !== '' && (
          <View wrap={false}>
            <Text style={styles.heading}>Notes</Text>
            <Text>{quote.notes}</Text>
          </View>
        )}

        {quote.drawings.elevations.map((elevation, i) => (
          <View key={elevation.wallId} wrap={false} break={i % 2 === 0}>
            <Text style={styles.heading}>Elevation of wall {elevation.label}</Text>
            <Image style={styles.drawing} src={elevation.image} />
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>
            {title} · Design version {quote.design_version} · Catalog {quote.catalog_version}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
