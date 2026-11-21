import React from 'react';
import styles from './Header.module.css';
import { Link, NavLink } from 'react-router-dom';
const NAV_ITEMS = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
  { label: 'Agent', to: '/agent' },
];

const Header: React.FC = () => {
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand}>
        <img
          src="https://blog.paulibaby.com/paulibaby.png"
          alt="Paulibaby logo"
          className={styles.siteLogo}
        />
        <div className={styles.siteTitle}>Paulibaby</div>
      </Link>

      <nav aria-label="Primary">
        <ul className={styles.navList}>
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={styles.navLink} end={item.to === '/'}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
};

export default Header;