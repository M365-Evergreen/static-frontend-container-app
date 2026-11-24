import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <section className="stack" aria-labelledby="not-found-heading">
      <h1 id="not-found-heading">404 - Page Not Found</h1>
      <p>The page you requested does not exist.</p>
      <p>
        <Link to="/">Return to Home</Link>
      </p>
    </section>
  );
}