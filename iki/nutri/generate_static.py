"""
Generate a static HTML dashboard for GitHub Pages deployment.
Uses Plotly.js for interactive visualizations - no server needed.

Run with: uv run --with pandas --with openpyxl --with plotly python generate_static.py
"""

import pandas as pd
import numpy as np
import json
from pathlib import Path


def main():
    # Load data
    print("Loading data...")
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
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Filter to products with required data
    df = df[
        df["actualPrice"].notna()
        & df["energy"].notna()
        & df["protein"].notna()
        & (df["energy"] > 0)
        & df["category"].notna()
    ].copy()

    print(f"Products with complete data: {len(df)}")

    # Calculate protein density (% of calories from protein)
    df["protein_density"] = (df["protein"] * 4 / df["energy"]) * 100
    df["protein_density"] = df["protein_density"].clip(0, 100)

    # Calculate ideal score
    price_norm = 1 - (df["actualPrice"] - df["actualPrice"].min()) / (
        df["actualPrice"].max() - df["actualPrice"].min() + 0.001
    )
    cal_norm = 1 - (df["energy"] - df["energy"].min()) / (
        df["energy"].max() - df["energy"].min() + 0.001
    )
    protein_norm = (df["protein_density"] - df["protein_density"].min()) / (
        df["protein_density"].max() - df["protein_density"].min() + 0.001
    )
    df["ideal_score"] = (
        (price_norm * 0.33) + (cal_norm * 0.33) + (protein_norm * 0.34)
    ) * 100

    # Get top categories
    top_categories = df["category"].value_counts().head(20).index.tolist()
    df["category_display"] = df["category"].apply(
        lambda x: x if x in top_categories else "Other"
    )

    # Sample for performance (max 2000 points)
    if len(df) > 2000:
        df = df.sample(2000, random_state=42)
        print(f"Sampled to 2000 products for performance")

    # Prepare data for JSON
    data = {
        "name": df["name"].tolist(),
        "category": df["category"].tolist(),
        "category_display": df["category_display"].tolist(),
        "price": df["actualPrice"].round(2).tolist(),
        "calories": df["energy"].round(0).tolist(),
        "protein": df["protein"].round(1).tolist(),
        "protein_density": df["protein_density"].round(1).tolist(),
        "ideal_score": df["ideal_score"].round(1).tolist(),
    }

    # Get unique categories for filter
    categories = ["All Categories"] + sorted(df["category_display"].unique().tolist())

    # Get top 20 ideal products
    top_products = df.nlargest(20, "ideal_score")[
        [
            "name",
            "category",
            "actualPrice",
            "energy",
            "protein",
            "protein_density",
            "ideal_score",
        ]
    ]
    top_products_html = top_products.to_html(
        index=False, classes="data-table", float_format=lambda x: f"{x:.1f}"
    )

    html_template = (
        """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IKI Food Explorer</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #eee;
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        h1 {
            text-align: center;
            margin-bottom: 10px;
            font-size: 2.5em;
            background: linear-gradient(90deg, #00d2ff, #3a7bd5);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle {
            text-align: center;
            color: #888;
            margin-bottom: 30px;
        }
        .controls {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            justify-content: center;
            margin-bottom: 20px;
            padding: 20px;
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
        }
        .control-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .control-group label {
            font-size: 0.85em;
            color: #aaa;
        }
        select, input[type="range"] {
            padding: 8px 12px;
            border-radius: 6px;
            border: 1px solid #444;
            background: #2a2a4a;
            color: #fff;
            font-size: 14px;
            min-width: 150px;
        }
        select:focus, input:focus {
            outline: none;
            border-color: #3a7bd5;
        }
        .chart-container {
            background: rgba(255,255,255,0.03);
            border-radius: 12px;
            padding: 15px;
            margin-bottom: 30px;
        }
        .metrics {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }
        .metric-card {
            background: rgba(255,255,255,0.05);
            padding: 20px;
            border-radius: 12px;
            text-align: center;
        }
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            color: #3a7bd5;
        }
        .metric-label {
            color: #888;
            font-size: 0.9em;
            margin-top: 5px;
        }
        .data-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            font-size: 14px;
        }
        .data-table th, .data-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #333;
        }
        .data-table th {
            background: rgba(58, 123, 213, 0.3);
            font-weight: 600;
        }
        .data-table tr:hover {
            background: rgba(255,255,255,0.05);
        }
        .section-title {
            font-size: 1.5em;
            margin: 30px 0 15px;
            color: #3a7bd5;
        }
        .instructions {
            background: rgba(58, 123, 213, 0.1);
            padding: 15px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            border-left: 4px solid #3a7bd5;
        }
        .instructions ul {
            margin-left: 20px;
            margin-top: 10px;
        }
        .instructions li {
            margin: 5px 0;
            color: #bbb;
        }
        .view-toggle {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin-bottom: 15px;
        }
        .view-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
            background: #2a2a4a;
            color: #fff;
        }
        .view-btn.active {
            background: #3a7bd5;
        }
        .view-btn:hover {
            background: #4a8be5;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>IKI Food Explorer</h1>
        <p class="subtitle">Find products that are cheap, low calorie, and high in protein</p>
        
        <div class="instructions">
            <strong>How to use:</strong>
            <ul>
                <li><strong>Best products</strong> are in the <strong>bottom-left</strong> (cheap + low calories) with <strong>high Z value</strong> (protein density)</li>
                <li>Drag to rotate the 3D view, scroll to zoom</li>
                <li>Hover over points to see product details</li>
                <li>Use filters below to narrow down by category or price</li>
            </ul>
        </div>
        
        <div class="metrics">
            <div class="metric-card">
                <div class="metric-value" id="metric-count">0</div>
                <div class="metric-label">Products Shown</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="metric-protein">0%</div>
                <div class="metric-label">Avg Protein Density</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="metric-price">€0</div>
                <div class="metric-label">Avg Price</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="metric-cal">0</div>
                <div class="metric-label">Avg Calories</div>
            </div>
        </div>
        
        <div class="controls">
            <div class="control-group">
                <label>Category</label>
                <select id="categoryFilter">
                    """
        + "\n".join([f'<option value="{cat}">{cat}</option>' for cat in categories])
        + """
                </select>
            </div>
            <div class="control-group">
                <label>Max Price: €<span id="priceValue">50</span></label>
                <input type="range" id="priceFilter" min="1" max="50" value="50">
            </div>
            <div class="control-group">
                <label>Max Calories: <span id="calValue">900</span></label>
                <input type="range" id="calFilter" min="50" max="900" value="900" step="50">
            </div>
            <div class="control-group">
                <label>Min Protein: <span id="proteinValue">0</span>g</label>
                <input type="range" id="proteinFilter" min="0" max="50" value="0">
            </div>
        </div>
        
        <div class="view-toggle">
            <button class="view-btn active" id="btn3d">3D View</button>
            <button class="view-btn" id="btn2d">2D View</button>
        </div>
        
        <div class="chart-container">
            <div id="chart"></div>
        </div>
        
        <h2 class="section-title">Top 20 Ideal Products</h2>
        <p style="color: #888; margin-bottom: 10px;">Sorted by Ideal Score (best combination of low price, low calories, high protein %)</p>
        """
        + top_products_html
        + """
    </div>

    <script>
        // Data
        const rawData = """
        + json.dumps(data)
        + """;
        
        let currentView = '3d';
        
        function filterData() {
            const category = document.getElementById('categoryFilter').value;
            const maxPrice = parseFloat(document.getElementById('priceFilter').value);
            const maxCal = parseFloat(document.getElementById('calFilter').value);
            const minProtein = parseFloat(document.getElementById('proteinFilter').value);
            
            const indices = [];
            for (let i = 0; i < rawData.name.length; i++) {
                const catMatch = category === 'All Categories' || rawData.category_display[i] === category;
                const priceMatch = rawData.price[i] <= maxPrice;
                const calMatch = rawData.calories[i] <= maxCal;
                const proteinMatch = rawData.protein[i] >= minProtein;
                
                if (catMatch && priceMatch && calMatch && proteinMatch) {
                    indices.push(i);
                }
            }
            
            return {
                name: indices.map(i => rawData.name[i]),
                category: indices.map(i => rawData.category[i]),
                category_display: indices.map(i => rawData.category_display[i]),
                price: indices.map(i => rawData.price[i]),
                calories: indices.map(i => rawData.calories[i]),
                protein: indices.map(i => rawData.protein[i]),
                protein_density: indices.map(i => rawData.protein_density[i]),
                ideal_score: indices.map(i => rawData.ideal_score[i]),
            };
        }
        
        function updateMetrics(data) {
            document.getElementById('metric-count').textContent = data.name.length;
            
            if (data.name.length > 0) {
                const avgProtein = data.protein_density.reduce((a, b) => a + b, 0) / data.protein_density.length;
                const avgPrice = data.price.reduce((a, b) => a + b, 0) / data.price.length;
                const avgCal = data.calories.reduce((a, b) => a + b, 0) / data.calories.length;
                
                document.getElementById('metric-protein').textContent = avgProtein.toFixed(1) + '%';
                document.getElementById('metric-price').textContent = '€' + avgPrice.toFixed(2);
                document.getElementById('metric-cal').textContent = Math.round(avgCal);
            }
        }
        
        function createChart() {
            const data = filterData();
            updateMetrics(data);
            
            const hovertemplate = '<b>%{text}</b><br>' +
                'Category: %{customdata[0]}<br>' +
                'Price: €%{customdata[1]:.2f}<br>' +
                'Calories: %{customdata[2]:.0f}<br>' +
                'Protein: %{customdata[3]:.1f}g<br>' +
                'Protein Density: %{customdata[4]:.1f}%<br>' +
                'Ideal Score: %{customdata[5]:.1f}<extra></extra>';
            
            const customdata = data.name.map((_, i) => [
                data.category[i],
                data.price[i],
                data.calories[i],
                data.protein[i],
                data.protein_density[i],
                data.ideal_score[i]
            ]);
            
            if (currentView === '3d') {
                const trace = {
                    type: 'scatter3d',
                    mode: 'markers',
                    x: data.price,
                    y: data.calories,
                    z: data.protein_density,
                    text: data.name,
                    customdata: customdata,
                    hovertemplate: hovertemplate,
                    marker: {
                        size: data.protein.map(p => Math.max(4, Math.min(20, p / 2))),
                        color: data.ideal_score,
                        colorscale: 'RdYlGn',
                        colorbar: {
                            title: 'Ideal<br>Score',
                            thickness: 15
                        },
                        opacity: 0.8
                    }
                };
                
                const layout = {
                    scene: {
                        xaxis: { title: 'Price (€) ← Lower is better' },
                        yaxis: { title: 'Calories ← Lower is better' },
                        zaxis: { title: 'Protein Density (%) ↑ Higher is better' },
                        camera: { eye: { x: 1.5, y: 1.5, z: 1.2 } }
                    },
                    height: 600,
                    margin: { l: 0, r: 0, t: 30, b: 0 },
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    font: { color: '#eee' }
                };
                
                Plotly.react('chart', [trace], layout);
            } else {
                const trace = {
                    type: 'scatter',
                    mode: 'markers',
                    x: data.price,
                    y: data.calories,
                    text: data.name,
                    customdata: customdata,
                    hovertemplate: hovertemplate,
                    marker: {
                        size: data.protein.map(p => Math.max(6, Math.min(30, p / 1.5))),
                        color: data.protein_density,
                        colorscale: 'RdYlGn',
                        colorbar: {
                            title: 'Protein<br>Density %',
                            thickness: 15
                        },
                        opacity: 0.7
                    }
                };
                
                const layout = {
                    xaxis: { title: 'Price (€) ← Lower is better', gridcolor: '#333' },
                    yaxis: { title: 'Calories ← Lower is better', gridcolor: '#333' },
                    height: 600,
                    margin: { l: 60, r: 30, t: 30, b: 60 },
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)',
                    font: { color: '#eee' },
                    annotations: [{
                        x: Math.min(...data.price) + 0.5,
                        y: Math.min(...data.calories) + 20,
                        text: '← IDEAL ZONE',
                        showarrow: true,
                        arrowhead: 2,
                        ax: 40,
                        ay: 40,
                        font: { size: 14, color: '#00cc96' }
                    }]
                };
                
                Plotly.react('chart', [trace], layout);
            }
        }
        
        // Event listeners
        document.getElementById('categoryFilter').addEventListener('change', createChart);
        
        document.getElementById('priceFilter').addEventListener('input', function() {
            document.getElementById('priceValue').textContent = this.value;
            createChart();
        });
        
        document.getElementById('calFilter').addEventListener('input', function() {
            document.getElementById('calValue').textContent = this.value;
            createChart();
        });
        
        document.getElementById('proteinFilter').addEventListener('input', function() {
            document.getElementById('proteinValue').textContent = this.value;
            createChart();
        });
        
        document.getElementById('btn3d').addEventListener('click', function() {
            currentView = '3d';
            this.classList.add('active');
            document.getElementById('btn2d').classList.remove('active');
            createChart();
        });
        
        document.getElementById('btn2d').addEventListener('click', function() {
            currentView = '2d';
            this.classList.add('active');
            document.getElementById('btn3d').classList.remove('active');
            createChart();
        });
        
        // Initial render
        createChart();
    </script>
</body>
</html>"""
    )

    # Write HTML file
    output_path = Path(__file__).parent / "index.html"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_template)

    print(f"\nGenerated: {output_path}")
    print("\nTo deploy to GitHub Pages:")
    print("1. Push to GitHub")
    print("2. Go to repo Settings > Pages")
    print("3. Select 'main' branch and '/ (root)'")
    print("4. Your site will be at: https://YOUR_USERNAME.github.io/REPO_NAME/")


if __name__ == "__main__":
    main()
