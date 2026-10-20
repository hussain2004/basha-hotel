
import { useEffect, useState } from 'react';
import type { MenuItem } from './types/menu';
import { initialMenu } from './services/menuData';
import Cart from './components/Cart';
import './App.css';

export type CartItem = {
  menuItemId: string;
  quantity: number;
};

type Language = 'en' | 'te';

const menuIcons: Record<string, string> = {
  idly: '🍚',
  'idly-full': '🍚',
  poori: '🫓',
  'poori-full': '🫓',
  'vuggani-bajji': '🍽️',
  'bajji-morning': '🌶️',
  'tea-morning': '☕',
  'tea-evening': '☕',
  'bajji-evening': '🌶️',
  'egg-bonda': '🥚',
  samosa: '🥟',
  vada: '🍩',
  'mysore-bonda': '🟤',
};

function App() {
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = localStorage.getItem('basha-theme');
    return savedTheme === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('basha-theme', theme);
  }, [theme]);
  
const [language, setLanguage] = useState<Language>('en');
const [menuItems] = useState<MenuItem[]>(initialMenu);
const [cartItems, setCartItems] = useState<CartItem[]>([]);
const [menuPage, setMenuPage] = useState<1 | 2>(1);

  const isTe = language === 'te';

  const addToCart = (item: MenuItem) => {
    if (!item.available) return;

    setCartItems((current) => {
      const existing = current.find(
        (cartItem) => cartItem.menuItemId === item.id,
      );

      if (existing) {
        return current.map((cartItem) =>
          cartItem.menuItemId === item.id
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem,
        );
      }

      return [...current, { menuItemId: item.id, quantity: 1 }];
    });
  };

  const changeQuantity = (id: string, amount: number) => {
    setCartItems((current) =>
      current
        .map((cartItem) =>
          cartItem.menuItemId === id
            ? { ...cartItem, quantity: cartItem.quantity + amount }
            : cartItem,
        )
        .filter((cartItem) => cartItem.quantity > 0),
    );
  };

  const totalItems = cartItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  const totalPrice = cartItems.reduce((total, cartItem) => {
    const menuItem = menuItems.find(
      (item) => item.id === cartItem.menuItemId,
    );

    return total + (menuItem?.price ?? 0) * cartItem.quantity;
  }, 0);

  const text = {
    home: isTe ? 'హోమ్' : 'Home',
    menu: isTe ? 'మెనూ' : 'Menu',
    about: isTe ? 'మా గురించి' : 'Our Story',
    contact: isTe ? 'సంప్రదించండి' : 'Contact',
    location: isTe ? 'ఉప్పలపాడు · కర్నూలు' : 'Uppalapadu · Kurnool',
    eyebrow: isTe
      ? 'మీ ఊరి రుచులు, మీ మనసుకు దగ్గరగా'
      : 'YOUR LOCAL TIFFIN & SNACKS STOP',
    headline: isTe
      ? 'ప్రతి రోజూ మీకు ఇష్టమైన రుచులు.'
      : 'Good food. Simple joys.',
    intro: isTe
      ? 'వేడి వేడి టిఫిన్లు, టీ మరియు సాయంత్రం ఇష్టమైన చిరుతిళ్లు.'
      : 'Hot tiffins, fresh tea and your favourite evening snacks.',
    explore: isTe ? 'మెనూ చూడండి' : 'Explore the Menu',
    find: isTe ? 'మమ్మల్ని సందర్శించండి' : 'Find Our Hotel',
    morning: isTe ? 'ఉదయం టిఫిన్లు' : 'Morning Tiffins',
    evening: isTe ? 'సాయంత్రం చిరుతిళ్లు' : 'Evening Snacks',
    morningIntro: isTe
      ? 'మీ రోజును రుచిగా ప్రారంభించండి.'
      : 'Start your day with familiar favourites.',
    eveningIntro: isTe
      ? 'టీతో పాటు వేడి వేడి స్నాక్స్.'
      : 'Your evening tea deserves a snack.',
    menuNote: isTe
      ? 'ధరలు రూపాయల్లో ఉన్నాయి.'
      : 'All prices are in Indian rupees.',
    storyTitle: isTe
      ? 'మన ఊరు. మన రుచులు.'
      : 'A familiar taste, close to home.',
    story: isTe
      ? 'ఉప్పలపాడులో మీకు ఇష్టమైన టిఫిన్లు, టీ మరియు సాయంత్రం చిరుతిళ్ల కోసం బాషా హోటల్.'
      : 'Basha Hotel serves the tiffins, tea and evening snacks you love in Uppalapadu.',
    visit: isTe ? 'మమ్మల్ని సందర్శించండి' : 'Come Visit Us',
    address: isTe
      ? 'ఉప్పలపాడు, కర్నూలు జిల్లా, ఆంధ్రప్రదేశ్'
      : 'Uppalapadu, Kurnool district, Andhra Pradesh',
    footer: isTe
      ? 'మీ ఆదరణకు ధన్యవాదాలు.'
      : 'Thank you for supporting your local hotel.',
  };

  const renderMenuItems = (category: 'morning' | 'evening') =>
    menuItems
      .filter((item) => item.category === category)
      .map((item) => {
        const quantity =
          cartItems.find((cartItem) => cartItem.menuItemId === item.id)
            ?.quantity ?? 0;

        return (
          <article className="menu-card" key={item.id}>
           <div className="menu-item-art">
  {(() => {
    const foodImages: Record<string, string> = {
      idly: 'idly-single.png',
      'idly-full': 'idly-full.png',
      poori: 'poori-single.png',
      'poori-full': 'poori-full.png',
      'vuggani-bajji': 'vuggani-bajji.png',
      'bajji-morning': 'bajji-M.png',
      'bajji-evening': 'bajji-M.png',
      'tea-morning': 'tea-menu.png',
      'tea-evening': 'tea-menu.png',
      'egg-bonda': 'egg-bonda.png',
      samosa: 'samosa-menu.png',
      vada: 'vada-menu.png',
      'mysore-bonda': 'mysore-bonda.png',
    };

    const image = foodImages[item.id];

    return image ? (
      <img
        src={`/images/${image}`}
        alt={`${item.name} served at Basha Hotel`}
        loading="lazy"
      />
    ) : (
      <span aria-hidden="true">
        {menuIcons[item.id] ?? '🍽️'}
      </span>
    );
  })()}
</div>
            <div className="menu-item-info">
              <h4>{isTe ? item.nameTe : item.name}</h4>
              <p>{isTe ? item.servingTe : item.serving}</p>
              <strong className="menu-price">₹{item.price}</strong>

              {!item.available && (
                <p>
                  {isTe
                    ? 'ప్రస్తుతం అందుబాటులో లేదు'
                    : 'Currently unavailable'}
                </p>
              )}

              <div className="menu-order-controls">
                {quantity === 0 ? (
                  <button
                    type="button"
                    className="menu-add-button"
                    onClick={() => addToCart(item)}
                    disabled={!item.available}
                  >
                    {isTe ? '+ చేర్చు' : '+ Add'}
                  </button>
                ) : (
                  <div className="quantity-controls">
                    <button
                      type="button"
                      onClick={() => changeQuantity(item.id, -1)}
                      aria-label={`Decrease ${item.name} quantity`}
                    >
                      −
                    </button>
                    <span>{quantity}</span>
                    <button
                      type="button"
                      onClick={() => addToCart(item)}
                      aria-label={`Increase ${item.name} quantity`}
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      });

  return (
    <div className="site-shell" id="home">
      <header className="site-header">
        <a className="brand" href="#home" aria-label="Basha Hotel home">
          <span className="brand-mark">
            B<span>.</span>
          </span>
          <span className="brand-copy">
            <strong>BASHA HOTEL</strong>
            <small>{isTe ? 'మన ఊరి హోటల్' : 'YOUR LOCAL HOTEL'}</small>
          </span>
        </a>

        <nav className="main-nav" aria-label="Main navigation">
          <a href="#home">{text.home}</a>
          <a href="#menu">{text.menu}</a>
          <a href="#story">{text.about}</a>
          <a href="#contact">{text.contact}</a>
        </nav>

        <button
          className="language-toggle"
          onClick={() => setLanguage(isTe ? 'en' : 'te')}
          aria-label={isTe ? 'Switch to English' : 'తెలుగులో చూడండి'}
        >
          {isTe ? 'EN / తెలుగు' : 'తెలుగు / EN'}
        </button>
                
<button
  type="button"
  className="theme-toggle"
  onClick={() =>
    setTheme((current) => (current === 'light' ? 'dark' : 'light'))
  }
  aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
  title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
>
  <span aria-hidden="true">{theme === 'light' ? '🌙' : '☀️'}</span>
</button>

      </header>

      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="eyebrow-dot" />
              {text.eyebrow}
            </span>
            <h1>{text.headline}</h1>
            <p className="hero-description">{text.intro}</p>

            <div className="hero-actions">
              <a className="button-primary" href="#menu">
                {text.explore} <span aria-hidden="true">↗</span>
              </a>
              <a className="button-secondary" href="#contact">
                {text.find}
              </a>
            </div>

            <div className="hero-meta">
              <span className="meta-icon">⌖</span>
              <span>{text.location}</span>
            </div>
          </div>

          <div
            className="hero-art"
            aria-label="Illustration of South Indian tiffin and tea"
          >
            
<div className="hero-art-label">
  FRESHLY SERVED · MADE WITH CARE
</div>


<div className="hero-food-circle">
  <img
    className="hero-food"
    src="/images/Bajji.png"
    alt="Freshly served mirchi bajji"
  />

  <img
    className="hero-food-small"
    src="/images/Tea.png"
    alt="Hot Indian tea"
  />

  <img
    className="hero-food-snack"
    src="/images/samosa.png"
    alt="Golden crispy samosas"
  />
</div>


            <div className="floating-note">
              <span>✳</span>
              <div>
                <strong>{isTe ? 'మన ఊరి రుచి' : 'A taste of home'}</strong>
                <small>{isTe ? 'బాషా హోటల్' : 'Basha Hotel'}</small>
              </div>
            </div>
            <div className="hero-art-caption">
              BASHA HOTEL <span>—</span> UPPALAPADU
            </div>
          </div>

          <div className="hero-bottom-line">
            <span>GOOD FOOD, EVERY DAY</span>
            <span>01 — WELCOME</span>
          </div>
        </section>

        
<section className="menu-section" id="menu">
  <div className="section-heading">
    <div>
      <span className="section-kicker">THE MENU · మా మెనూ</span>
      <h2>{isTe ? 'మీకు ఇష్టమైనవి' : 'What are you craving?'}</h2>
      <p>{text.menuNote}</p>
    </div>
    <span className="menu-stamp">
      MADE FOR
      <br />
      OUR VILLAGE
    </span>
  </div>

  <div className="menu-group">
    <div className="menu-group-heading">
      <div>
        <span className="section-kicker">
          {menuPage === 1 ? '01 / MORNING' : '02 / EVENING'}
        </span>
        <h3>{menuPage === 1 ? text.morning : text.evening}</h3>
        <p>{menuPage === 1 ? text.morningIntro : text.eveningIntro}</p>
      </div>
      <span
        className={`group-icon ${menuPage === 2 ? 'evening-icon' : ''}`}
        aria-hidden="true"
      >
        {menuPage === 1 ? '☀' : '☾'}
      </span>
    </div>

    <div className="menu-grid">
      {renderMenuItems(menuPage === 1 ? 'morning' : 'evening')}
    </div>
  </div>

  <nav className="menu-pagination" aria-label="Menu pages">
    <button
      type="button"
      className={`menu-page-button ${menuPage === 1 ? 'active' : ''}`}
      onClick={() => setMenuPage(1)}
      aria-current={menuPage === 1 ? 'page' : undefined}
    >
      1
      <span>{isTe ? 'ఉదయం' : 'Morning'}</span>
    </button>

    <button
      type="button"
      className={`menu-page-button ${menuPage === 2 ? 'active' : ''}`}
      onClick={() => setMenuPage(2)}
      aria-current={menuPage === 2 ? 'page' : undefined}
    >
      2
      <span>{isTe ? 'సాయంత్రం' : 'Evening'}</span>
    </button>
  </nav>
</section>

        <Cart
          items={menuItems}
          cartItems={cartItems}
          language={language}
          onChangeQuantity={changeQuantity}
        />

        <section className="story-section" id="story">
          <div className="story-symbol" aria-hidden="true">
            B<span>.</span>
          </div>
          <div className="story-copy">
            <span className="section-kicker">A LOCAL FAVOURITE</span>
            <h2>{text.storyTitle}</h2>
            <p>{text.story}</p>
          </div>
          <div className="story-location">
            <span className="location-pin">⌖</span>
            <strong>{text.location}</strong>
            <span>{isTe ? 'ఆంధ్రప్రదేశ్' : 'Andhra Pradesh, India'}</span>
          </div>
        </section>

        
<section className="contact-section" id="contact">
  <div>
    <span className="section-kicker">VISIT BASHA HOTEL</span>
    <h2>{text.visit}</h2>
    <p>{text.address}</p>

    <div className="contact-details">
      <p>
        <strong>{isTe ? 'ఫోన్ నంబర్' : 'Phone'}:</strong>{' '}
        <a href="tel:9398369003">9398369003</a>
      </p>

      <p>
        <strong>{isTe ? 'ఉదయం' : 'Morning'}:</strong>{' '}
        5:00 AM – 10:00 AM
      </p>

      <p>
        <strong>{isTe ? 'సాయంత్రం' : 'Evening'}:</strong>{' '}
        3:00 PM – 9:00 PM
      </p>
    </div>

    <a className="button-primary" href="tel:9398369003">
      {isTe ? 'హోటల్‌కు కాల్ చేయండి' : 'Call the Hotel'}
    </a>
  </div>

  <a className="button-primary" href="#home">
    {isTe ? 'పైకి వెళ్లండి' : 'Back to top'} ↑
  </a>
</section>

      </main>

      <footer className="site-footer">
        <a className="footer-brand" href="#home">
          BASHA HOTEL<span>.</span>
        </a>
        <p>{text.footer}</p>
        <span>UPPALAPADU · KURNOOL</span>
      </footer>

      {totalItems > 0 && (
        <a className="floating-cart-link" href="#pickup-cart">
          <span>
            {isTe ? 'మీ ఆర్డర్' : 'Your order'} · {totalItems}{' '}
            {isTe ? 'వస్తువులు' : 'items'}
          </span>
          <strong>₹{totalPrice}</strong>
          <span>{isTe ? 'చూడండి ↓' : 'Review ↓'}</span>
        </a>
      )}
    </div>
  );
}

export default App;
