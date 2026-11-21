import React from 'react';
import styles from './Header.module.css';
import { NavLink } from 'react-router-dom';
const NAV_ITEMS = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
];

const Header: React.FC = () => {
    return (
            <header className={styles.header}>
              <div className={styles.headerInner}>
                <div className={styles.brandWrapper}>
                <NavLink to="/" className={styles.brand}>
                  Paulibaby
                </NavLink>
      
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
                </div>  
              </div>
            </header>
    );
};

export default Header;