import React from 'react';
import { IconType } from 'react-icons';
import { Link } from 'react-router-dom';
import { FaFacebookF, FaTwitter, FaInstagram, FaPinterestP } from 'react-icons/fa';
import { socialLinks, storeName } from '../utils/store';

const SOCIAL_ICONS: Record<string, IconType> = {
  Facebook: FaFacebookF,
  Twitter: FaTwitter,
  Instagram: FaInstagram,
  Pinterest: FaPinterestP,
};

const Footer: React.FC = () => {
  // Only the profiles that are actually configured. See utils/store.ts.
  const social = socialLinks();

  return (
    <footer className="footer">
      <div className="footer__content">
        <div className="footer__section">
          <h3 className="footer__title">Shop</h3>
          <ul className="footer__list">
            <li><Link to="/search">All products</Link></li>
            <li><Link to="/">New arrivals</Link></li>
            <li><Link to="/wishlist">Your wishlist</Link></li>
            <li><Link to="/orders">Your orders</Link></li>
          </ul>
        </div>
        {/* These used to be `mailto:` links and links to "/" wearing the labels
            of pages that did not exist — "Our story", "Careers", "Press" all
            went to the home page. A footer link that lands somewhere unrelated
            is worse than no link, so every entry here now points at a page that
            answers what it promises. */}
        <div className="footer__section">
          <h3 className="footer__title">Customer service</h3>
          <ul className="footer__list">
            <li><Link to="/contact">Contact us</Link></li>
            <li><Link to="/orders">Track an order</Link></li>
            <li><Link to="/shipping-policy">Shipping &amp; delivery</Link></li>
            <li><Link to="/returns-policy">Returns &amp; refunds</Link></li>
          </ul>
        </div>
        <div className="footer__section">
          <h3 className="footer__title">About us</h3>
          <ul className="footer__list">
            <li><Link to="/about">Our story</Link></li>
            <li><Link to="/contact">Get in touch</Link></li>
            <li><Link to="/terms">Terms of service</Link></li>
            <li><Link to="/privacy">Privacy</Link></li>
          </ul>
        </div>
        {/* This was a newsletter signup that cleared the field and toasted
            "Thanks — you're on the list." There was no endpoint behind it and
            no list: a control that reports a success that did not happen. It is
            not replaced with a working one here, because a second mailing list
            is a consent surface with no unsubscribe path — the backend already
            has `User.emailOptOut` and a signed unsubscribe link for people who
            have accounts (utils/unsubscribe.ts), and that is the mechanism a new
            signup form would have to join rather than sidestep. */}
        <div className="footer__section footer__newsletter">
          <h3 className="footer__title">Stay connected</h3>
          <p>
            Order updates and delivery notices are sent to the address on your
            account. Manage what we send you in{" "}
            <Link to="/settings">your settings</Link>.
          </p>
          {/* Rendered only for profiles that are configured — an absent icon is
              honest, an href="#" that scrolls to the top is not. */}
          {social.length > 0 && (
            <div className="footer__social">
              {social.map(({ label, url }) => {
                const Icon = SOCIAL_ICONS[label];
                return (
                  <a
                    key={label}
                    href={url}
                    aria-label={label}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <Icon />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="footer__bottom">
        <p>&copy; {new Date().getFullYear()} {storeName()}. All rights reserved.</p>
        <ul className="footer__legal">
          <li><Link to="/privacy">Privacy policy</Link></li>
          <li><Link to="/terms">Terms of service</Link></li>
          <li><Link to="/returns-policy">Returns</Link></li>
        </ul>
      </div>
    </footer>
  );
};

export default Footer;
