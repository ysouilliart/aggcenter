# Sample invoices for the parser pipeline

OCI (and the local storage provider) uses this folder layout under
`aggcenter/invoices/`:

```
landing/      drop zone — new files land here
received/     claimed for parsing
processed/    successfully classified
archived/     closed after review
anomaly/      needs review (scanned, unsupported, low confidence)
```

Bundled samples in `landing/` (Hotjar, Tesla, Origin Energy, a scanned PDF,
and a CSV) are copied into the active storage provider when the landing
prefix is empty. Click **Sync landing folder** on the Invoices page.
