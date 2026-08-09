import { Link } from "react-router-dom";
import Seo from "../../components/Seo";
import { storeAddress, storeName, supportEmail, supportPhone } from "../../utils/store";

/**
 * Contact.
 *
 * Its own component rather than another entry in `documents.ts` because it is
 * not prose — it is a small set of actionable details, and a `mailto:` that
 * actually opens a mail client is the whole point of the page.
 *
 * There is deliberately no contact *form*. A form here would need a backend
 * endpoint, spam handling and somewhere for the messages to land, and until
 * those exist a form that silently drops what people type is worse than an
 * email address that works.
 */
const Contact = () => {
  const email = supportEmail();
  const phone = supportPhone();

  return (
    <div className="page static-page">
      <Seo
        title="Contact us"
        description={`How to reach ${storeName()} about an order, a return or anything else.`}
      />

      <header className="static-page__head">
        <h1>Contact us</h1>
        <p className="static-page__intro">
          A person reads every message. Quoting your order number gets you a
          faster answer than describing the items.
        </p>
      </header>

      <div className="static-page__body">
        <section>
          <h2>Email</h2>
          <p>
            <a href={`mailto:${email}`}>{email}</a>
          </p>
          <p>
            We answer on working days, usually within one. If it is about an
            order you can also open the order under{" "}
            <Link to="/orders">Your orders</Link> and reply to any email we have
            already sent about it — that keeps everything in one thread.
          </p>
        </section>

        {phone && (
          <section>
            <h2>Phone</h2>
            <p>
              <a href={`tel:${phone.replace(/\s/g, "")}`}>{phone}</a>
            </p>
          </section>
        )}

        <section>
          <h2>Post</h2>
          <p>{storeAddress()}</p>
          <p>
            Please do not post returns to this address without opening a return
            first — an unannounced parcel cannot be matched to an order. Start
            one from <Link to="/orders">Your orders</Link>, and we will confirm
            where to send it.
          </p>
        </section>

        <section>
          <h2>Before you write</h2>
          <p>
            These answer most questions on their own:{" "}
            <Link to="/shipping-policy">shipping and delivery times</Link>,{" "}
            <Link to="/returns-policy">returns and refunds</Link>.
          </p>
        </section>
      </div>
    </div>
  );
};

export default Contact;
