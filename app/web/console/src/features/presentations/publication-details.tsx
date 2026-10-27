import type { Publication } from "./management-api";

export function PublicationDetails({ publication }: { publication: Publication }) {
  return (
    <dl className="grid gap-2 break-all text-sm">
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
  );
}
