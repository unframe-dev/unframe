import type { Publication } from "./management-api";

export function PublicationDetails({ publication }: { publication: Publication }) {
  return (
    <details className="text-sm">
      <summary className="w-fit cursor-pointer text-[var(--muted)]">技術情報</summary>
      <dl className="mt-4 grid gap-3 break-all">
        <div>
          <dt>Presentation ID</dt>
          <dd>{publication.presentationId}</dd>
        </div>
        <div>
          <dt>Build ID</dt>
          <dd>{publication.buildId}</dd>
        </div>
        <div>
          <dt>Publication epoch</dt>
          <dd>{publication.publicationEpoch}</dd>
        </div>
        <div>
          <dt>Publication manifest hash</dt>
          <dd>{publication.publicationManifestHash}</dd>
        </div>
        <div>
          <dt>Definition hash</dt>
          <dd>{publication.definitionHash}</dd>
        </div>
        <div>
          <dt>Render bundle hash</dt>
          <dd>{publication.renderBundleHash}</dd>
        </div>
        <div>
          <dt>Asset set hash</dt>
          <dd>{publication.assetSetHash}</dd>
        </div>
      </dl>
    </details>
  );
}
