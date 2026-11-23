-- Passage à une plateforme 100 % Pi: tous les montants en Pi (7 décimales), plus de FCFA, plus de paiement à la livraison.
-- Idempotent: peut être rejoué sans risque.
ALTER TABLE products       ALTER COLUMN price SET DATA TYPE NUMERIC(14,7), ALTER COLUMN promo_price SET DATA TYPE NUMERIC(14,7);
ALTER TABLE delivery_zones ALTER COLUMN fee SET DATA TYPE NUMERIC(14,7), ALTER COLUMN min_order SET DATA TYPE NUMERIC(14,7);
ALTER TABLE orders         ALTER COLUMN subtotal SET DATA TYPE NUMERIC(14,7), ALTER COLUMN delivery_fee SET DATA TYPE NUMERIC(14,7),
                           ALTER COLUMN total SET DATA TYPE NUMERIC(14,7), ALTER COLUMN final_total SET DATA TYPE NUMERIC(14,7);
ALTER TABLE order_items    ALTER COLUMN unit_price SET DATA TYPE NUMERIC(14,7), ALTER COLUMN line_total SET DATA TYPE NUMERIC(14,7);
ALTER TABLE deliveries     ALTER COLUMN fee SET DATA TYPE NUMERIC(14,7);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='amount_fcfa') THEN
    UPDATE payments SET amount_pi = 0 WHERE amount_pi IS NULL;
    ALTER TABLE payments DROP COLUMN amount_fcfa;
  END IF;
END $$;
ALTER TABLE payments ALTER COLUMN amount_pi SET DATA TYPE NUMERIC(14,7), ALTER COLUMN amount_pi SET NOT NULL;

ALTER TABLE orders   DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
UPDATE orders   SET payment_method='pi' WHERE payment_method <> 'pi';
UPDATE payments SET method='pi' WHERE method <> 'pi';
ALTER TABLE orders   ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('pi'));
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('pi'));
ALTER TABLE orders   ALTER COLUMN payment_method SET DEFAULT 'pi';

DELETE FROM settings WHERE key IN ('pi_rate_fcfa','free_delivery_threshold');
