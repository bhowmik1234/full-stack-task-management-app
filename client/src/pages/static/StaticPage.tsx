import Seo from "../../components/Seo";
import { documents } from "./documents";

/**
 * Renders one of the policy documents.
 *
 * Six pages, one component: they differ only in words, so a component each would
 * be six places for the layout to drift. The slug is a prop rather than a route
 * param so each page is a named route in App.tsx — a `/:slug` catch-all would
 * swallow every unknown path and turn a typo into a blank policy page instead of
 * a 404.
 */
const StaticPage = ({ slug }: { slug: string }) => {
  const doc = documents[slug];

  // Unreachable through the router — every slug below is declared as a route —
  // but rendering nothing would be a silent blank page if that ever changed.
  if (!doc) return null;

  return (
    <div className="page static-page">
      <Seo title={doc.title} description={doc.description} />

      <header className="static-page__head">
        <h1>{doc.title}</h1>
        <p className="static-page__intro">{doc.intro}</p>
        {doc.updated && (
          <p className="static-page__updated">Last updated {doc.updated}</p>
        )}
      </header>

      <div className="static-page__body">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((block, index) =>
              Array.isArray(block) ? (
                <ul key={index}>
                  {block.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p key={index}>{block}</p>
              )
            )}
          </section>
        ))}
      </div>
    </div>
  );
};

export default StaticPage;
