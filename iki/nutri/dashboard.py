"""
IKI Food Data Explorer Dashboard
Run with: uv run --with streamlit --with pandas --with openpyxl --with plotly streamlit run dashboard.py
"""

import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
from pathlib import Path

# Page config
st.set_page_config(
    page_title="IKI Food Explorer",
    page_icon="🛒",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom CSS
st.markdown(
    """
<style>
    .metric-card {
        background-color: #f0f2f6;
        border-radius: 10px;
        padding: 15px;
        margin: 5px 0;
    }
    .big-font {
        font-size: 24px !important;
        font-weight: bold;
    }
</style>
""",
    unsafe_allow_html=True,
)


@st.cache_data
def load_data():
    """Load and preprocess the IKI food data."""
    df = pd.read_excel(Path(__file__).parent / "iki_food_data.xlsx")

    # Convert numeric columns
    numeric_cols = [
        "energy",
        "fat",
        "satFat",
        "carbs",
        "sugar",
        "protein",
        "salt",
        "actualPrice",
        "loyaltyPrice",
        "conversionValue",
        "prince per unit",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Calculate useful derived columns
    df["has_nutrition"] = df["protein"].notna() & df["energy"].notna()
    df["has_price"] = df["actualPrice"].notna()

    # Protein per euro (higher is better)
    df["protein_per_euro"] = df["protein"] / df["actualPrice"]
    df["protein_per_euro"] = df["protein_per_euro"].replace([np.inf, -np.inf], np.nan)

    # Calories per euro
    df["calories_per_euro"] = df["energy"] / df["actualPrice"]
    df["calories_per_euro"] = df["calories_per_euro"].replace([np.inf, -np.inf], np.nan)

    # Protein to calorie ratio (protein density)
    df["protein_density"] = (
        df["protein"] * 4 / df["energy"]
    ) * 100  # % of calories from protein
    df["protein_density"] = df["protein_density"].replace([np.inf, -np.inf], np.nan)

    # Loyalty discount
    df["discount_amount"] = df["actualPrice"] - df["loyaltyPrice"]
    df["discount_pct"] = (df["discount_amount"] / df["actualPrice"]) * 100

    # Health score (higher protein, lower sugar, lower sat fat, lower salt = better)
    # Normalize each component 0-100, then average
    def normalize_col(series, higher_is_better=True):
        min_val, max_val = series.min(), series.max()
        if max_val == min_val:
            return pd.Series([50] * len(series))
        normalized = (series - min_val) / (max_val - min_val) * 100
        if not higher_is_better:
            normalized = 100 - normalized
        return normalized

    # Only calculate health score where we have all data
    mask = (
        df["protein"].notna()
        & df["sugar"].notna()
        & df["satFat"].notna()
        & df["salt"].notna()
    )
    df.loc[mask, "health_score"] = (
        normalize_col(df.loc[mask, "protein"], higher_is_better=True) * 0.4
        + normalize_col(df.loc[mask, "sugar"], higher_is_better=False) * 0.25
        + normalize_col(df.loc[mask, "satFat"], higher_is_better=False) * 0.2
        + normalize_col(df.loc[mask, "salt"], higher_is_better=False) * 0.15
    )

    return df


def calculate_value_score(
    df,
    price_weight=0.4,
    protein_weight=0.4,
    calorie_weight=0.2,
    lower_calories_better=True,
):
    """Calculate composite value score for products."""
    result = df.copy()

    # Only score products with all required data
    mask = (
        result["actualPrice"].notna()
        & result["protein"].notna()
        & result["energy"].notna()
    )
    valid_df = result.loc[mask].copy()

    if len(valid_df) == 0:
        result["value_score"] = np.nan
        return result

    # Normalize price (lower is better -> invert)
    price_norm = 1 - (valid_df["actualPrice"] - valid_df["actualPrice"].min()) / (
        valid_df["actualPrice"].max() - valid_df["actualPrice"].min()
    )

    # Normalize protein (higher is better)
    protein_norm = (valid_df["protein"] - valid_df["protein"].min()) / (
        valid_df["protein"].max() - valid_df["protein"].min()
    )

    # Normalize calories
    cal_norm = (valid_df["energy"] - valid_df["energy"].min()) / (
        valid_df["energy"].max() - valid_df["energy"].min()
    )
    if lower_calories_better:
        cal_norm = 1 - cal_norm

    # Composite score
    result.loc[mask, "value_score"] = (
        price_norm * price_weight
        + protein_norm * protein_weight
        + cal_norm * calorie_weight
    ) * 100

    return result


def main():
    st.title("🛒 IKI Food Data Explorer")
    st.markdown(
        "Analyze ~8,000 products from IKI grocery store - find the best value for your nutrition goals!"
    )

    # Load data
    df = load_data()

    # Sidebar filters
    st.sidebar.header("🔧 Filters")

    # Category filter
    categories = ["All Categories"] + sorted(df["category"].dropna().unique().tolist())
    selected_category = st.sidebar.selectbox("Category", categories)

    # Apply category filter
    if selected_category != "All Categories":
        filtered_df = df[df["category"] == selected_category].copy()
    else:
        filtered_df = df.copy()

    # Price range
    price_min = float(df["actualPrice"].min()) if df["actualPrice"].notna().any() else 0
    price_max = (
        float(df["actualPrice"].max()) if df["actualPrice"].notna().any() else 100
    )
    price_range = st.sidebar.slider(
        "Price Range (€)",
        min_value=price_min,
        max_value=min(price_max, 50.0),  # Cap at 50 for better UX
        value=(price_min, min(price_max, 50.0)),
        step=0.5,
    )
    filtered_df = filtered_df[
        (filtered_df["actualPrice"] >= price_range[0])
        & (filtered_df["actualPrice"] <= price_range[1])
        | filtered_df["actualPrice"].isna()
    ]

    # Protein filter
    min_protein = st.sidebar.slider("Minimum Protein (g)", 0, 50, 0)
    if min_protein > 0:
        filtered_df = filtered_df[filtered_df["protein"] >= min_protein]

    # Calorie filter
    max_calories = st.sidebar.slider("Maximum Calories", 0, 900, 900)
    if max_calories < 900:
        filtered_df = filtered_df[filtered_df["energy"] <= max_calories]

    # Show filter results
    st.sidebar.markdown("---")
    st.sidebar.metric("Products Shown", f"{len(filtered_df):,}", f"of {len(df):,}")

    # Main content tabs
    tab0, tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs(
        [
            "🎯 Ideal Finder",
            "🏆 Best Value",
            "💰 Price Analysis",
            "💪 Protein Analysis",
            "🔥 Calorie Analysis",
            "❤️ Health Score",
            "🔍 Product Explorer",
        ]
    )

    # ============ TAB 0: IDEAL FINDER (3D Visualization) ============
    with tab0:
        st.header("🎯 Find Your Ideal Products")
        st.markdown("""
        **Goal:** Find products that are **cheap**, **low calorie**, and have **high protein proportion**.
        
        The 3D plot below shows all products. **Best products are in the bottom-left corner with HIGH protein density (bright green/yellow).**
        - Drag to rotate the 3D view
        - Scroll to zoom
        - Hover for product details
        - Use filters in the sidebar to narrow down
        """)

        # Prepare data for 3D plot
        ideal_df = filtered_df[
            filtered_df["actualPrice"].notna()
            & filtered_df["energy"].notna()
            & filtered_df["protein"].notna()
            & (filtered_df["energy"] > 0)  # Avoid division by zero
        ].copy()

        # Calculate protein density (% of calories from protein)
        # Protein has 4 calories per gram
        ideal_df["protein_density"] = (
            ideal_df["protein"] * 4 / ideal_df["energy"]
        ) * 100
        ideal_df["protein_density"] = ideal_df["protein_density"].clip(
            0, 100
        )  # Cap at 100%

        # Calculate "Ideal Score" - combines all 3 factors
        # Normalize each to 0-1, then combine
        if len(ideal_df) > 0:
            price_norm = 1 - (
                ideal_df["actualPrice"] - ideal_df["actualPrice"].min()
            ) / (ideal_df["actualPrice"].max() - ideal_df["actualPrice"].min() + 0.001)
            cal_norm = 1 - (ideal_df["energy"] - ideal_df["energy"].min()) / (
                ideal_df["energy"].max() - ideal_df["energy"].min() + 0.001
            )
            protein_norm = (
                ideal_df["protein_density"] - ideal_df["protein_density"].min()
            ) / (
                ideal_df["protein_density"].max()
                - ideal_df["protein_density"].min()
                + 0.001
            )

            ideal_df["ideal_score"] = (
                (price_norm * 0.33) + (cal_norm * 0.33) + (protein_norm * 0.34)
            ) * 100

        if len(ideal_df) == 0:
            st.warning(
                "No products match your filters. Try adjusting the sidebar filters."
            )
        else:
            # Metrics row
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.metric("Products Analyzed", f"{len(ideal_df):,}")
            with col2:
                st.metric(
                    "Avg Protein Density", f"{ideal_df['protein_density'].mean():.1f}%"
                )
            with col3:
                st.metric("Avg Price", f"€{ideal_df['actualPrice'].mean():.2f}")
            with col4:
                st.metric("Avg Calories", f"{ideal_df['energy'].mean():.0f}")

            st.markdown("---")

            # View mode selection
            col_view1, col_view2 = st.columns(2)
            with col_view1:
                view_mode = st.radio(
                    "Visualization Mode",
                    ["3D Scatter (Interactive)", "2D Scatter (Simpler)"],
                    horizontal=True,
                )
            with col_view2:
                color_mode = st.radio(
                    "Color By",
                    ["Category", "Ideal Score"],
                    horizontal=True,
                )

            # Sample if too many points
            plot_df = ideal_df.copy()
            if len(plot_df) > 1000:
                st.info(
                    f"Showing 1000 random products out of {len(plot_df):,} for performance. Use sidebar filters to narrow down."
                )
                plot_df = plot_df.sample(1000, random_state=42)

            # Limit categories for better visualization (top N by count)
            if color_mode == "Category":
                top_categories = (
                    plot_df["category"].value_counts().head(15).index.tolist()
                )
                plot_df["category_display"] = plot_df["category"].apply(
                    lambda x: x if x in top_categories else "Other"
                )
                color_col = "category_display"
                color_scale = None  # Use default discrete colors
            else:
                color_col = "ideal_score"
                color_scale = "RdYlGn"

            if view_mode == "3D Scatter (Interactive)":
                # 3D Scatter Plot
                fig = px.scatter_3d(
                    plot_df,
                    x="actualPrice",
                    y="energy",
                    z="protein_density",
                    color=color_col,
                    size="protein",
                    size_max=20,
                    hover_name="name",
                    hover_data={
                        "category": True,
                        "actualPrice": ":.2f",
                        "energy": ":.0f",
                        "protein": ":.1f",
                        "protein_density": ":.1f",
                        "ideal_score": ":.1f",
                    },
                    color_continuous_scale=color_scale,
                    labels={
                        "actualPrice": "Price (€)",
                        "energy": "Calories",
                        "protein_density": "Protein Density (%)",
                        "ideal_score": "Ideal Score",
                        "protein": "Protein (g)",
                        "category_display": "Category",
                    },
                    title="🎯 Ideal Products: Low Price + Low Calories + High Protein Density",
                )

                fig.update_layout(
                    height=700,
                    scene=dict(
                        xaxis_title="Price (€) ← Lower is better",
                        yaxis_title="Calories ← Lower is better",
                        zaxis_title="Protein Density (%) ↑ Higher is better",
                        camera=dict(eye=dict(x=1.5, y=1.5, z=1.2)),
                    ),
                )

                if color_mode == "Ideal Score":
                    fig.update_layout(coloraxis_colorbar=dict(title="Ideal<br>Score"))

                st.plotly_chart(fig, use_container_width=True)

            else:
                # 2D Scatter - Price vs Calories
                fig = px.scatter(
                    plot_df,
                    x="actualPrice",
                    y="energy",
                    color=color_col,
                    size="protein",
                    size_max=25,
                    hover_name="name",
                    hover_data={
                        "category": True,
                        "actualPrice": ":.2f",
                        "energy": ":.0f",
                        "protein": ":.1f",
                        "protein_density": ":.1f",
                        "ideal_score": ":.1f",
                    },
                    color_continuous_scale=color_scale,
                    labels={
                        "actualPrice": "Price (€)",
                        "energy": "Calories",
                        "protein_density": "Protein Density (%)",
                        "protein": "Protein (g)",
                        "category_display": "Category",
                    },
                    title="🎯 Best Products are Bottom-Left (Low Price + Low Calories)",
                )

                fig.update_layout(height=600)

                # Add annotation for ideal corner
                fig.add_annotation(
                    x=plot_df["actualPrice"].min(),
                    y=plot_df["energy"].min(),
                    text="← IDEAL ZONE",
                    showarrow=True,
                    arrowhead=2,
                    ax=50,
                    ay=50,
                    font=dict(size=14, color="green"),
                )

                st.plotly_chart(fig, use_container_width=True)

            st.markdown("---")

            # Top ideal products table
            st.subheader("🏅 Top 20 Ideal Products")
            st.markdown(
                "Sorted by **Ideal Score** (best combination of low price, low calories, high protein %)"
            )

            top_ideal = ideal_df.nlargest(20, "ideal_score")[
                [
                    "name",
                    "category",
                    "actualPrice",
                    "energy",
                    "protein",
                    "protein_density",
                    "ideal_score",
                ]
            ].copy()
            top_ideal.columns = [
                "Product",
                "Category",
                "Price (€)",
                "Calories",
                "Protein (g)",
                "Protein Density (%)",
                "Ideal Score",
            ]
            top_ideal["Protein Density (%)"] = top_ideal["Protein Density (%)"].round(1)
            top_ideal["Ideal Score"] = top_ideal["Ideal Score"].round(1)

            st.dataframe(top_ideal, use_container_width=True, hide_index=True)

            # Best per category
            st.subheader("🥇 Best Ideal Product per Category (Top 15 Categories)")
            valid_cats = ideal_df[ideal_df["category"].notna()]
            if len(valid_cats) > 0:
                best_cat_idx = valid_cats.groupby("category")["ideal_score"].idxmax()
                best_per_category = ideal_df.loc[best_cat_idx][
                    [
                        "name",
                        "category",
                        "actualPrice",
                        "energy",
                        "protein",
                        "protein_density",
                        "ideal_score",
                    ]
                ].nlargest(15, "ideal_score")
                best_per_category.columns = [
                    "Product",
                    "Category",
                    "Price (€)",
                    "Calories",
                    "Protein (g)",
                    "Protein Density (%)",
                    "Ideal Score",
                ]
                best_per_category["Protein Density (%)"] = best_per_category[
                    "Protein Density (%)"
                ].round(1)
                best_per_category["Ideal Score"] = best_per_category[
                    "Ideal Score"
                ].round(1)
                st.dataframe(
                    best_per_category, use_container_width=True, hide_index=True
                )

    # ============ TAB 1: BEST VALUE ============
    with tab1:
        st.header("🏆 Best Value Products")
        st.markdown(
            "Find products with the best combination of **low price**, **high protein**, and **optimal calories**."
        )

        col1, col2, col3, col4 = st.columns(4)
        with col1:
            price_w = st.slider("Price Weight", 0.0, 1.0, 0.4, 0.1, key="pw")
        with col2:
            protein_w = st.slider("Protein Weight", 0.0, 1.0, 0.4, 0.1, key="prw")
        with col3:
            cal_w = st.slider("Calorie Weight", 0.0, 1.0, 0.2, 0.1, key="cw")
        with col4:
            lower_cal = st.checkbox("Lower calories = better", value=True)

        # Calculate value scores
        scored_df = calculate_value_score(
            filtered_df,
            price_weight=price_w,
            protein_weight=protein_w,
            calorie_weight=cal_w,
            lower_calories_better=lower_cal,
        )

        # Top products table
        st.subheader("Top 15 Best Value Products")
        top_products = scored_df.nlargest(15, "value_score")[
            ["name", "category", "actualPrice", "protein", "energy", "value_score"]
        ].copy()
        top_products.columns = [
            "Product",
            "Category",
            "Price (€)",
            "Protein (g)",
            "Calories",
            "Value Score",
        ]
        top_products["Value Score"] = top_products["Value Score"].round(1)
        st.dataframe(top_products, use_container_width=True, hide_index=True)

        # Scatter plot
        st.subheader("Price vs Protein (bubble size = calories)")
        plot_df = scored_df[scored_df["has_nutrition"] & scored_df["has_price"]].copy()
        if len(plot_df) > 500:
            plot_df = plot_df.sample(500, random_state=42)

        fig = px.scatter(
            plot_df,
            x="actualPrice",
            y="protein",
            size="energy",
            color="value_score",
            hover_name="name",
            hover_data=["category", "energy"],
            color_continuous_scale="RdYlGn",
            labels={
                "actualPrice": "Price (€)",
                "protein": "Protein (g)",
                "energy": "Calories",
                "value_score": "Value Score",
            },
        )
        fig.update_layout(height=500)
        st.plotly_chart(fig, use_container_width=True)

        # Best per category
        st.subheader("🥇 Best Value by Category")
        # Filter out rows with NaN category or value_score before groupby
        valid_for_groupby = scored_df[
            scored_df["category"].notna() & scored_df["value_score"].notna()
        ]
        if len(valid_for_groupby) > 0:
            best_idx = valid_for_groupby.groupby("category")["value_score"].idxmax()
            best_per_cat = scored_df.loc[best_idx][
                ["name", "category", "actualPrice", "protein", "energy", "value_score"]
            ].dropna()
            best_per_cat = best_per_cat.nlargest(20, "value_score")
        else:
            best_per_cat = pd.DataFrame(
                columns=[
                    "name",
                    "category",
                    "actualPrice",
                    "protein",
                    "energy",
                    "value_score",
                ]
            )
        best_per_cat.columns = [
            "Product",
            "Category",
            "Price (€)",
            "Protein (g)",
            "Calories",
            "Value Score",
        ]
        best_per_cat["Value Score"] = best_per_cat["Value Score"].round(1)
        st.dataframe(best_per_cat, use_container_width=True, hide_index=True)

    # ============ TAB 2: PRICE ANALYSIS ============
    with tab2:
        st.header("💰 Price Analysis")

        col1, col2, col3 = st.columns(3)
        price_data = filtered_df[filtered_df["actualPrice"].notna()]
        with col1:
            st.metric("Average Price", f"€{price_data['actualPrice'].mean():.2f}")
        with col2:
            st.metric("Median Price", f"€{price_data['actualPrice'].median():.2f}")
        with col3:
            st.metric(
                "Price Range",
                f"€{price_data['actualPrice'].min():.2f} - €{price_data['actualPrice'].max():.2f}",
            )

        # Price distribution
        st.subheader("Price Distribution")
        fig = px.histogram(
            price_data,
            x="actualPrice",
            nbins=50,
            labels={"actualPrice": "Price (€)"},
            color_discrete_sequence=["#636EFA"],
        )
        fig.update_layout(showlegend=False, height=400)
        st.plotly_chart(fig, use_container_width=True)

        # Average price by category
        st.subheader("Average Price by Category (Top 20)")
        cat_prices = (
            filtered_df.groupby("category")["actualPrice"]
            .agg(["mean", "count"])
            .reset_index()
        )
        cat_prices = cat_prices[cat_prices["count"] >= 5].nlargest(20, "mean")

        fig = px.bar(
            cat_prices,
            x="mean",
            y="category",
            orientation="h",
            labels={"mean": "Average Price (€)", "category": "Category"},
            color="mean",
            color_continuous_scale="Blues",
        )
        fig.update_layout(height=600, showlegend=False)
        st.plotly_chart(fig, use_container_width=True)

        # Loyalty discounts
        st.subheader("💳 Best Loyalty Discounts")
        discount_df = (
            filtered_df[filtered_df["discount_pct"] > 0]
            .nlargest(15, "discount_pct")[
                ["name", "category", "actualPrice", "loyaltyPrice", "discount_pct"]
            ]
            .copy()
        )
        discount_df.columns = [
            "Product",
            "Category",
            "Regular Price (€)",
            "Loyalty Price (€)",
            "Discount (%)",
        ]
        discount_df["Discount (%)"] = discount_df["Discount (%)"].round(1)
        st.dataframe(discount_df, use_container_width=True, hide_index=True)

    # ============ TAB 3: PROTEIN ANALYSIS ============
    with tab3:
        st.header("💪 Protein Analysis")

        protein_data = filtered_df[filtered_df["protein"].notna()]

        col1, col2, col3 = st.columns(3)
        with col1:
            st.metric("Avg Protein", f"{protein_data['protein'].mean():.1f}g")
        with col2:
            st.metric("Max Protein", f"{protein_data['protein'].max():.1f}g")
        with col3:
            high_protein_count = len(protein_data[protein_data["protein"] >= 20])
            st.metric("High Protein (≥20g)", f"{high_protein_count} products")

        # Top protein products
        st.subheader("🥩 Highest Protein Products")
        top_protein = protein_data.nlargest(15, "protein")[
            ["name", "category", "protein", "energy", "actualPrice"]
        ].copy()
        top_protein.columns = [
            "Product",
            "Category",
            "Protein (g)",
            "Calories",
            "Price (€)",
        ]
        st.dataframe(top_protein, use_container_width=True, hide_index=True)

        # Protein per euro
        st.subheader("💶 Best Protein per Euro")
        protein_value = filtered_df[
            filtered_df["protein_per_euro"].notna()
            & (filtered_df["protein_per_euro"] > 0)
        ]
        top_protein_value = protein_value.nlargest(15, "protein_per_euro")[
            ["name", "category", "protein", "actualPrice", "protein_per_euro"]
        ].copy()
        top_protein_value.columns = [
            "Product",
            "Category",
            "Protein (g)",
            "Price (€)",
            "Protein/€",
        ]
        top_protein_value["Protein/€"] = top_protein_value["Protein/€"].round(2)
        st.dataframe(top_protein_value, use_container_width=True, hide_index=True)

        # Protein vs Calories scatter
        st.subheader("Protein vs Calories")
        plot_df = filtered_df[filtered_df["has_nutrition"]].copy()
        if len(plot_df) > 500:
            plot_df = plot_df.sample(500, random_state=42)

        fig = px.scatter(
            plot_df,
            x="energy",
            y="protein",
            color="category"
            if selected_category == "All Categories"
            and plot_df["category"].nunique() <= 10
            else None,
            hover_name="name",
            hover_data=["actualPrice"],
            labels={"energy": "Calories", "protein": "Protein (g)"},
            opacity=0.6,
        )
        fig.update_layout(height=500)
        st.plotly_chart(fig, use_container_width=True)

        # Protein by category
        st.subheader("Average Protein by Category (Top 20)")
        cat_protein = (
            filtered_df.groupby("category")["protein"]
            .agg(["mean", "count"])
            .reset_index()
        )
        cat_protein = cat_protein[cat_protein["count"] >= 5].nlargest(20, "mean")

        fig = px.bar(
            cat_protein,
            x="mean",
            y="category",
            orientation="h",
            labels={"mean": "Average Protein (g)", "category": "Category"},
            color="mean",
            color_continuous_scale="Greens",
        )
        fig.update_layout(height=600, showlegend=False)
        st.plotly_chart(fig, use_container_width=True)

    # ============ TAB 4: CALORIE ANALYSIS ============
    with tab4:
        st.header("🔥 Calorie Analysis")

        cal_data = filtered_df[filtered_df["energy"].notna()]

        col1, col2, col3 = st.columns(3)
        with col1:
            st.metric("Avg Calories", f"{cal_data['energy'].mean():.0f}")
        with col2:
            st.metric("Median Calories", f"{cal_data['energy'].median():.0f}")
        with col3:
            low_cal_count = len(cal_data[cal_data["energy"] <= 100])
            st.metric("Low Calorie (≤100)", f"{low_cal_count} products")

        # Calorie distribution
        st.subheader("Calorie Distribution")
        fig = px.histogram(
            cal_data,
            x="energy",
            nbins=50,
            labels={"energy": "Calories (per 100g/ml)"},
            color_discrete_sequence=["#EF553B"],
        )
        fig.update_layout(showlegend=False, height=400)
        st.plotly_chart(fig, use_container_width=True)

        # Low calorie high protein
        st.subheader("🥗 Low Calorie + High Protein (Best of Both)")
        lc_hp = filtered_df[
            (filtered_df["energy"] <= 150)
            & (filtered_df["protein"] >= 10)
            & filtered_df["actualPrice"].notna()
        ].copy()
        lc_hp["protein_density"] = lc_hp["protein_density"].round(1)
        lc_hp_display = lc_hp.nlargest(15, "protein")[
            ["name", "category", "energy", "protein", "protein_density", "actualPrice"]
        ]
        lc_hp_display.columns = [
            "Product",
            "Category",
            "Calories",
            "Protein (g)",
            "Protein Density (%)",
            "Price (€)",
        ]
        st.dataframe(lc_hp_display, use_container_width=True, hide_index=True)

        # Calories by category
        st.subheader("Average Calories by Category (Top 20)")
        cat_cal = (
            filtered_df.groupby("category")["energy"]
            .agg(["mean", "count"])
            .reset_index()
        )
        cat_cal = cat_cal[cat_cal["count"] >= 5].nlargest(20, "mean")

        fig = px.bar(
            cat_cal,
            x="mean",
            y="category",
            orientation="h",
            labels={"mean": "Average Calories", "category": "Category"},
            color="mean",
            color_continuous_scale="OrRd",
        )
        fig.update_layout(height=600, showlegend=False)
        st.plotly_chart(fig, use_container_width=True)

    # ============ TAB 5: HEALTH SCORE ============
    with tab5:
        st.header("❤️ Health Score Analysis")
        st.markdown("""
        **Health Score** is calculated based on:
        - High Protein (40% weight)
        - Low Sugar (25% weight)  
        - Low Saturated Fat (20% weight)
        - Low Salt (15% weight)
        """)

        health_data = filtered_df[filtered_df["health_score"].notna()]

        col1, col2 = st.columns(2)
        with col1:
            st.metric(
                "Avg Health Score", f"{health_data['health_score'].mean():.1f}/100"
            )
        with col2:
            st.metric("Products with Score", f"{len(health_data):,}")

        # Healthiest products
        st.subheader("Healthiest Products")
        healthiest = health_data.nlargest(20, "health_score")[
            [
                "name",
                "category",
                "health_score",
                "protein",
                "sugar",
                "satFat",
                "salt",
                "actualPrice",
            ]
        ].copy()
        healthiest.columns = [
            "Product",
            "Category",
            "Health Score",
            "Protein",
            "Sugar",
            "Sat Fat",
            "Salt",
            "Price (€)",
        ]
        healthiest["Health Score"] = healthiest["Health Score"].round(1)
        st.dataframe(healthiest, use_container_width=True, hide_index=True)

        # Health score distribution
        st.subheader("Health Score Distribution")
        fig = px.histogram(
            health_data,
            x="health_score",
            nbins=50,
            labels={"health_score": "Health Score"},
            color_discrete_sequence=["#00CC96"],
        )
        fig.update_layout(showlegend=False, height=400)
        st.plotly_chart(fig, use_container_width=True)

        # Health score by category
        st.subheader("Average Health Score by Category")
        cat_health = (
            health_data.groupby("category")["health_score"]
            .agg(["mean", "count"])
            .reset_index()
        )
        cat_health = cat_health[cat_health["count"] >= 5].nlargest(20, "mean")

        fig = px.bar(
            cat_health,
            x="mean",
            y="category",
            orientation="h",
            labels={"mean": "Avg Health Score", "category": "Category"},
            color="mean",
            color_continuous_scale="Greens",
        )
        fig.update_layout(height=600, showlegend=False)
        st.plotly_chart(fig, use_container_width=True)

    # ============ TAB 6: PRODUCT EXPLORER ============
    with tab6:
        st.header("🔍 Product Explorer")

        # Search
        search_term = st.text_input("Search products by name", "")

        if search_term:
            search_df = filtered_df[
                filtered_df["name"]
                .str.lower()
                .str.contains(search_term.lower(), na=False)
            ]
        else:
            search_df = filtered_df

        st.markdown(f"**Showing {len(search_df):,} products**")

        # Display columns
        display_cols = [
            "name",
            "category",
            "actualPrice",
            "energy",
            "protein",
            "carbs",
            "fat",
            "sugar",
            "salt",
        ]
        display_df = search_df[display_cols].copy()
        display_df.columns = [
            "Name",
            "Category",
            "Price (€)",
            "Calories",
            "Protein",
            "Carbs",
            "Fat",
            "Sugar",
            "Salt",
        ]

        st.dataframe(display_df, use_container_width=True, hide_index=True, height=600)

        # Product comparison
        st.subheader("Compare Products")
        available_products = filtered_df[filtered_df["name"].notna()]["name"].tolist()

        if len(available_products) > 0:
            selected_products = st.multiselect(
                "Select products to compare (max 5)",
                available_products[:1000],  # Limit for performance
                max_selections=5,
            )

            if len(selected_products) >= 2:
                compare_df = filtered_df[
                    filtered_df["name"].isin(selected_products)
                ].copy()

                # Radar chart for comparison
                categories_radar = ["protein", "carbs", "fat", "sugar", "salt"]

                fig = go.Figure()
                for _, row in compare_df.iterrows():
                    values = [
                        row[cat] if pd.notna(row[cat]) else 0
                        for cat in categories_radar
                    ]
                    values.append(values[0])  # Close the radar

                    fig.add_trace(
                        go.Scatterpolar(
                            r=values,
                            theta=categories_radar + [categories_radar[0]],
                            name=row["name"][:30] + "..."
                            if len(row["name"]) > 30
                            else row["name"],
                        )
                    )

                fig.update_layout(
                    polar=dict(
                        radialaxis=dict(
                            visible=True,
                            range=[
                                0,
                                max(50, compare_df[categories_radar].max().max()),
                            ],
                        )
                    ),
                    showlegend=True,
                    height=500,
                )
                st.plotly_chart(fig, use_container_width=True)

                # Comparison table
                compare_display = compare_df[
                    [
                        "name",
                        "category",
                        "actualPrice",
                        "energy",
                        "protein",
                        "carbs",
                        "fat",
                        "sugar",
                        "salt",
                    ]
                ].copy()
                compare_display.columns = [
                    "Name",
                    "Category",
                    "Price (€)",
                    "Calories",
                    "Protein",
                    "Carbs",
                    "Fat",
                    "Sugar",
                    "Salt",
                ]
                st.dataframe(compare_display, use_container_width=True, hide_index=True)

    # Footer
    st.markdown("---")
    st.markdown("*Data source: IKI grocery store product catalog*")


if __name__ == "__main__":
    main()
