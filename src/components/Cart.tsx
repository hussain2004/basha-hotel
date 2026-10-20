
import { useEffect, useState, type FormEvent } from 'react';
import type { MenuItem } from '../types/menu';

export type CartItem = {
  menuItemId: string;
  quantity: number;
};

type CartProps = {
  items: MenuItem[];
  cartItems: CartItem[];
  language: 'en' | 'te';
  onChangeQuantity: (id: string, amount: number) => void;
};

type OrderResponse = {
  message?: string;
  order?: {
    id: number;
    status: string;
    createdAt: string;
    trackingToken: string;
  };
};

type CustomerOrder = {
  id: number;
  status: string;
  items: string;
  createdAt: string;
  updatedAt?: string | null;
};

function Cart({
  items,
  cartItems,
  language,
  onChangeQuantity,
}: CartProps) {
  const isTe = language === 'te';

  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [pickupNote, setPickupNote] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [savedOrderId, setSavedOrderId] = useState<number | null>(() => {
    const saved = localStorage.getItem('basha-last-order-id');
    if (!saved) return null;

    const id = Number(saved);
    return Number.isInteger(id) && id > 0 ? id : null;
  });

  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  const totalItems = cartItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  const totalPrice = cartItems.reduce((total, cartItem) => {
    const menuItem = items.find(
      (item) => item.id === cartItem.menuItemId,
    );

    return total + (menuItem?.price ?? 0) * cartItem.quantity;
  }, 0);

  // Load all orders for the saved mobile number.
  
useEffect(() => {
  let cancelled = false;
  let isLoading = false;

  async function loadCustomerOrders() {
    if (isLoading || cancelled) return;

    isLoading = true;

    try {
      const savedOrderId = localStorage.getItem('basha-last-order-id');

      if (!savedOrderId) {
        if (!cancelled) setCustomerOrders([]);
        return;
      }

      const orderId = Number(savedOrderId);
      const token = localStorage.getItem(`basha-order-token-${orderId}`);

      if (!Number.isSafeInteger(orderId) || orderId < 1 || !token) {
        if (!cancelled) {
          setCustomerOrders([]);
          setStatusError(
            isTe
              ? 'ఈ ఆర్డర్‌ను ట్రాక్ చేయడానికి టోకెన్ కనుగొనబడలేదు.'
              : 'Tracking information is unavailable for this order.',
          );
        }
        return;
      }

      const response = await fetch(
        `/api/customer/orders/${orderId}`,
        {
          cache: 'no-store',
          headers: { 'X-Order-Token': token },
        },
      );

      const result = await response.json();

      if (!response.ok || !result.order) {
        throw new Error(
          result.message || 'Could not load your order.',
        );
      }

      if (!cancelled) {
        setCustomerOrders([result.order]);
        setSavedOrderId(orderId);
        setStatusError('');
      }
    } catch (error) {
      if (!cancelled) {
        setStatusError(
          error instanceof Error
            ? error.message
            : 'Could not load your order.',
        );
      }
    } finally {
      isLoading = false;
      if (!cancelled) setStatusLoading(false);
    }
  }

  void loadCustomerOrders();

  const refreshInterval = window.setInterval(() => {
    void loadCustomerOrders();
  }, 60_000);

  return () => {
    cancelled = true;
    window.clearInterval(refreshInterval);
  };
}, [savedOrderId, isTe]);


  // Submit a new pickup request.
  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    if (cartItems.length === 0 || isSubmitting) return;

    setErrorMessage('');
    setStatusError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerName: customerName.trim(),
          phone: phone.trim(),
          pickupNote: pickupNote.trim(),
          items: cartItems.map((cartItem) => ({
            menuItemId: cartItem.menuItemId,
            quantity: cartItem.quantity,
          })),
        }),
      });

      const result: OrderResponse = await response.json();

      if (!response.ok || !result.order) {
        throw new Error(
          result.message ||
            (isTe
              ? 'ఆర్డర్ అభ్యర్థన పంపలేకపోయాము.'
              : 'Could not submit your pickup request.'),
        );
      }

      const newOrder = result.order;

localStorage.setItem(
  'basha-last-order-id',
  String(newOrder.id),
);

localStorage.setItem(
  `basha-order-token-${newOrder.id}`,
  newOrder.trackingToken,
);

      // Remember the customer's details for the next order.
      setCustomerName(customerName.trim());
      setPhone(phone.trim());
      setPickupNote('');
      setShowOrderForm(false);

      // Refresh the full order history for this phone number.
      setSavedOrderId(newOrder.id);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : isTe
            ? 'ఏదో సమస్య వచ్చింది. మళ్లీ ప్రయత్నించండి.'
            : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Refresh the complete order history.
  const refreshOrderStatus = async () => {
  const savedOrderId = localStorage.getItem('basha-last-order-id');

  if (!savedOrderId) {
    setStatusError(
      isTe
        ? 'ఆర్డర్ వివరాలు కనుగొనబడలేదు.'
        : 'Order details could not be found.',
    );
    return;
  }

  const orderId = Number(savedOrderId);
  const token = localStorage.getItem(`basha-order-token-${orderId}`);

  if (!Number.isSafeInteger(orderId) || orderId < 1 || !token) {
    setStatusError(
      isTe
        ? 'ఈ ఆర్డర్‌ను ట్రాక్ చేయడానికి టోకెన్ కనుగొనబడలేదు.'
        : 'Tracking information is unavailable for this order.',
    );
    return;
  }

  setStatusLoading(true);
  setStatusError('');

  try {
    const response = await fetch(`/api/customer/orders/${orderId}`, {
      cache: 'no-store',
      headers: { 'X-Order-Token': token },
    });

    const result = await response.json();

    if (!response.ok || !result.order) {
      throw new Error(
        result.message || 'Could not refresh your order.',
      );
    }

    setCustomerOrders([result.order]);
    setSavedOrderId(orderId);
  } catch (error) {
    setStatusError(
      error instanceof Error
        ? error.message
        : 'Could not refresh your order.',
    );
  } finally {
    setStatusLoading(false);
  }
};

  const handlePlaceAnotherOrder = () => {
    setShowOrderForm(true);
    setErrorMessage('');
    setStatusError('');
  };

  const getStatusMessage = (status: string) => {
    if (status === 'accepted') {
      return isTe
        ? 'మీ ఆర్డర్‌ను హోటల్ అంగీకరించింది.'
        : 'Your order has been accepted by the hotel.';
    }

    if (status === 'rejected') {
      return isTe
        ? 'క్షమించండి, హోటల్ మీ ఆర్డర్‌ను అంగీకరించలేదు.'
        : 'Sorry, the hotel could not accept your order.';
    }

    return isTe
      ? 'హోటల్ సమీక్ష కోసం వేచి ఉండండి.'
      : 'Please wait for the hotel to review your request.';
  };

  const getMenuItemName = (id: string) => {
    const menuItem = items.find((item) => item.id === id);

    return menuItem
      ? isTe
        ? menuItem.nameTe
        : menuItem.name
      : id;
  };

  const getOrderItems = (order: CustomerOrder): CartItem[] => {
    try {
      const parsed: unknown = JSON.parse(order.items);

      if (Array.isArray(parsed)) {
        return parsed.filter(
          (item): item is CartItem =>
            typeof item.menuItemId === 'string' &&
            typeof item.quantity === 'number',
        );
      }
    } catch {
      // Handle invalid or unexpected stored item data.
    }

    return [];
  };

  const getFormattedDate = (date: string) => {
    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return date;
    }

    return parsedDate.toLocaleString(
      isTe ? 'te-IN' : 'en-IN',
      {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    );
  };

  return (
    <section className="cart-section" id="pickup-cart">
      <div className="section-heading">
        <div>
          <span className="section-kicker">
            {isTe ? 'పికప్ ఆర్డర్' : 'PICKUP ORDER'}
          </span>

          <h2>{isTe ? 'మీ ఆర్డర్' : 'Your order'}</h2>

          <p>
            {isTe
              ? 'మీరు మెనూలో ఎంచుకున్న వస్తువులను ఇక్కడ చూడండి.'
              : 'Review the items you selected directly from the menu above.'}
          </p>
        </div>

        <span className="menu-stamp">
          {totalItems} {isTe ? 'వస్తువులు' : 'ITEMS'}
        </span>
      </div>

      <div className="cart-summary">
        <h3>{isTe ? 'మీ ఎంపికలు' : 'Selected items'}</h3>

        {cartItems.length === 0 ? (
          <p>
            {isTe
              ? 'మీకు కావలసిన వాటిని మెనూలో + బటన్ ద్వారా చేర్చండి.'
              : 'Your cart is empty. Add items using the + buttons in the menu above.'}
          </p>
        ) : (
          cartItems.map((cartItem) => {
            const menuItem = items.find(
              (item) => item.id === cartItem.menuItemId,
            );

            if (!menuItem) return null;

            return (
              <div
                className="cart-item-row"
                key={cartItem.menuItemId}
              >
                <div>
                  <strong>
                    {isTe ? menuItem.nameTe : menuItem.name}
                  </strong>

                  <p>
                    ₹{menuItem.price} × {cartItem.quantity} = ₹
                    {menuItem.price * cartItem.quantity}
                  </p>

                  <p>
                    {isTe
                      ? menuItem.servingTe
                      : menuItem.serving}
                  </p>
                </div>

                <div className="quantity-controls">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeQuantity(menuItem.id, -1)
                    }
                    aria-label={`Decrease ${menuItem.name} quantity`}
                  >
                    −
                  </button>

                  <span>{cartItem.quantity}</span>

                  <button
                    type="button"
                    onClick={() =>
                      onChangeQuantity(menuItem.id, 1)
                    }
                    aria-label={`Increase ${menuItem.name} quantity`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })
        )}

        <div className="cart-total">
          <span>{isTe ? 'మొత్తం' : 'Total'}</span>
          <strong>₹{totalPrice}</strong>
        </div>

        {customerOrders.length > 0 && (
          <div
            className="customer-order-history"
            aria-live="polite"
          >
            <h3>{isTe ? 'మీ ఆర్డర్లు' : 'Your orders'}</h3>

            <p>
              {isTe
                ? 'ప్రతి ఆర్డర్ స్థితిని విడిగా చూడండి.'
                : 'Check the status of each order separately.'}
            </p>

            {customerOrders.map((order) => {
              const parsedItems = getOrderItems(order);

              const statusLabel =
                order.status.charAt(0).toUpperCase() +
                order.status.slice(1);

              return (
                <div
                  className="pickup-success customer-order-card"
                  key={order.id}
                >
                  <h4>
                    {isTe
                      ? `ఆర్డర్ నంబర్: ${order.id}`
                      : `Order #${order.id}`}
                  </h4>

                  <p>
                    <strong>
                      {isTe ? 'స్థితి: ' : 'Status: '}
                    </strong>
                    {statusLabel}
                  </p>

                  <p>{getStatusMessage(order.status)}</p>

                  <p>
                    <strong>
                      {isTe ? 'వస్తువులు: ' : 'Items: '}
                    </strong>

                    {parsedItems.length > 0
                      ? parsedItems
                          .map(
                            (item) =>
                              `${getMenuItemName(item.menuItemId)} × ${item.quantity}`,
                          )
                          .join(', ')
                      : isTe
                        ? 'వస్తువుల వివరాలు అందుబాటులో లేవు'
                        : 'Item details unavailable'}
                  </p>

                  <p>
                    <strong>
                      {isTe ? 'ఆర్డర్ సమయం: ' : 'Placed: '}
                    </strong>
                    {getFormattedDate(order.createdAt)}
                  </p>
                </div>
              );
            })}

            <button
              type="button"
              className="pickup-refresh-button"
              onClick={refreshOrderStatus}
              disabled={statusLoading}
            >
              {statusLoading
                ? isTe
                  ? 'చూస్తోంది...'
                  : 'Refreshing...'
                : isTe
                  ? 'అన్ని ఆర్డర్ల స్థితిని మళ్లీ చూడండి'
                  : 'Refresh all order statuses'}
            </button>

            {statusError && (
              <p className="pickup-error" role="alert">
                {statusError}
              </p>
            )}
          </div>
        )}

        {customerOrders.length > 0 && !showOrderForm ? (
          <button
            type="button"
            className="place-another-order-btn"
            onClick={handlePlaceAnotherOrder}
          >
            {isTe ? 'మరో ఆర్డర్ చేయండి' : 'Place Another Order'}
          </button>
        ) : (
          <>
            <h3 className="pickup-form-title">
              {isTe ? 'పికప్ వివరాలు' : 'Pickup details'}
            </h3>

            <form className="pickup-form" onSubmit={handleSubmit}>
              <label htmlFor="customer-name">
                {isTe ? 'మీ పేరు' : 'Your name'}
              </label>

              <input
                id="customer-name"
                name="customerName"
                type="text"
                autoComplete="name"
                placeholder={
                  isTe ? 'పేరు నమోదు చేయండి' : 'Enter your name'
                }
                value={customerName}
                onChange={(event) =>
                  setCustomerName(event.target.value)
                }
                required
                maxLength={80}
              />

              <label htmlFor="customer-phone">
                {isTe ? 'మొబైల్ నంబర్' : 'Mobile number'}
              </label>

              <input
                id="customer-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                inputMode="numeric"
                pattern="[0-9]{10}"
                maxLength={10}
                placeholder={
                  isTe
                    ? '10 అంకెల నంబర్'
                    : '10-digit mobile number'
                }
                value={phone}
                onChange={(event) =>
                  setPhone(
                    event.target.value
                      .replace(/\D/g, '')
                      .slice(0, 10),
                  )
                }
                required
              />

              <label htmlFor="pickup-note">
                {isTe
                  ? 'అదనపు వివరాలు (ఐచ్ఛికం)'
                  : 'Pickup note (optional)'}
              </label>

              <textarea
                id="pickup-note"
                name="pickupNote"
                rows={3}
                maxLength={200}
                placeholder={
                  isTe
                    ? 'ఏదైనా ప్రత్యేక సూచనలు ఉంటే నమోదు చేయండి'
                    : 'Any special instructions'
                }
                value={pickupNote}
                onChange={(event) =>
                  setPickupNote(event.target.value)
                }
              />

              {errorMessage && (
                <p className="pickup-error" role="alert">
                  {errorMessage}
                </p>
              )}

              <button
                type="submit"
                className="pickup-submit-button"
                disabled={cartItems.length === 0 || isSubmitting}
              >
                {isSubmitting
                  ? isTe
                    ? 'పంపుతోంది...'
                    : 'Submitting...'
                  : isTe
                    ? 'పికప్ అభ్యర్థన పంపండి'
                    : 'Submit pickup request'}
              </button>
            </form>

            <p className="cart-note">
              {isTe
                ? 'మీ అభ్యర్థన పెండింగ్‌లో ఉంటుంది. హోటల్ ఆమోదించిన తర్వాతే ఆర్డర్ నిర్ధారించబడుతుంది.'
                : 'Your request remains pending until the hotel accepts it. Submitting a request does not guarantee acceptance.'}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export default Cart;
