CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    clerk_id VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE property_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL
);

INSERT INTO property_types (name, slug)
VALUES ('Condominium', 'condominium'),
       ('House', 'house'),
       ('Warehouse', 'warehouse'),
       ('Land', 'land');

CREATE TABLE property_classifications (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL
);

INSERT INTO property_classifications (name, slug)
VALUES ('Residential', 'residential'),
       ('Industrial', 'industrial'),
       ('Commercial', 'commercial');

CREATE TABLE listing_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL
);

INSERT INTO listing_types (name, slug)
VALUES ('For Sale', 'for-sale'),
       ('For Rent', 'for-rent');

CREATE TABLE property_status (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL
);

INSERT INTO property_status (name, slug)
VALUES ('Available', 'available'),
       ('Rented', 'rented'),
       ('Sold', 'sold');

create table regions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    region_id VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE cities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    city_id VARCHAR(100) UNIQUE NOT NULL,
    region_id VARCHAR(100),
    slug VARCHAR(100) UNIQUE NOT NULL,
    FOREIGN KEY (region_id) REFERENCES regions(region_id)
);

CREATE INDEX trgm_cities_name_idx_gist ON cities USING GIST (name gist_trgm_ops);

CREATE INDEX idx_city_name ON cities(name);

CREATE TABLE property_agents (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) UNIQUE NOT NULL,
    verified BOOLEAN DEFAULT false,
    rating DOUBLE PRECISION,
    website_url VARCHAR(255)
);

CREATE TABLE listings (
    id SERIAL PRIMARY KEY,
    user_id INT,
    agent_id INT,
    listing_title TEXT UNIQUE NOT NULL,
    listing_url TEXT UNIQUE NOT NULL,
    listing_type_id INT NOT NULL,
    sub_category VARCHAR(200),
    property_status_id INT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    price DOUBLE PRECISION,
    price_formatted VARCHAR(255),
    price_for_rent_per_sqm DOUBLE PRECISION,
    price_for_sale_per_sqm DOUBLE PRECISION,
    price_for_rent_per_sqm_formatted VARCHAR(100),
    price_for_sale_per_sqm_formatted VARCHAR(100),
    coordinates GEOGRAPHY(Point),
    latitude_in_text VARCHAR(255),
    longitude_in_text VARCHAR(255),
    description TEXT,
    ai_description TEXT,
    scraped_property BOOLEAN DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (agent_id) REFERENCES property_agents(id),
    FOREIGN KEY (listing_type_id) REFERENCES listing_types(id),
    FOREIGN KEY (property_status_id) REFERENCES property_status(id)
);

CREATE INDEX listing_geo_index ON listings USING GIST(coordinates);

CREATE INDEX trgm_property_listing_description_idx_gist ON listings USING GIST (description gist_trgm_ops);

CREATE TABLE properties (
    id SERIAL PRIMARY KEY,
    listing_id INT UNIQUE NOT NULL,
    property_type_id INT NOT NULL,
    building_name VARCHAR(200),
    subdivision_name VARCHAR(200),
    floor_area DOUBLE PRECISION DEFAULT 0.0,
    lot_area DOUBLE PRECISION DEFAULT 0.0,
    building_size DOUBLE PRECISION DEFAULT 0.0,
    bedrooms INT DEFAULT 0,
    bathrooms INT DEFAULT 0,
    parking_space INT DEFAULT 0,
    unit_no VARCHAR(100),
    floor_no VARCHAR(100),
    city_id INT,
    area VARCHAR(200),
    address TEXT,
    features VARCHAR[] DEFAULT '{}',
    features_with_icon JSON DEFAULT '[]'::json,
    equipments VARCHAR[] DEFAULT '{}',
    equipments_with_icon JSON DEFAULT '[]'::json,
    main_image_url TEXT,
    project_name VARCHAR(200),
    is_peza_compliant BOOLEAN DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_type_id) REFERENCES property_types(id),
    FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
    FOREIGN KEY (city_id) REFERENCES cities(id)
);

CREATE TABLE property_features (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE  NOT NULL,
    icon_label VARCHAR(100) NOT NULL,
    icon_provider VARCHAR(100) NOT NULL,
    target_device VARCHAR(100)
);

CREATE TABLE property_images (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    property_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
);

CREATE TABLE valuations (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    city_id INT,
    address TEXT NOT NULL,
    property_size DOUBLE PRECISION,
    property_type_id INT NOT NULL,
    estimated_formatted_average_price_sale TEXT,
    estimated_formatted_average_price_per_sqm_sale TEXT,
    top_ten_similar_properties_sale JSON[],
    estimated_formatted_average_price_rent TEXT,
    estimated_formatted_average_price_per_sqm_rent TEXT,
    top_ten_similar_properties_rent JSON[],
    google_places_data_id VARCHAR(100),
    google_places_details_id VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(clerk_id),
    FOREIGN KEY  (city_id) REFERENCES cities(id),
    FOREIGN KEY (property_type_id) REFERENCES property_types(id)
);

CREATE INDEX idx_valuation_user_id ON valuations(user_id);