
from dataclasses import dataclass

@dataclass
class SolarConfig:
    panel_w: float = 400.0
    efficiency: float = 0.80
    battery_kwh: float = 2.0
    usable_fraction: float = 0.90
    daily_load_kwh: float = 0.48

def simulate(days, config, initial_kwh=0.0):
    capacity = config.battery_kwh * config.usable_fraction

    if capacity <= 0:
        raise ValueError("Battery capacity must be positive.")
    if not 0 <= initial_kwh <= capacity:
        raise ValueError("Initial energy is outside usable capacity.")
    if config.panel_w < 0 or not 0 <= config.efficiency <= 1:
        raise ValueError("Invalid panel power or efficiency.")
    if config.daily_load_kwh < 0:
        raise ValueError("Daily load must be nonnegative.")

    battery = initial_kwh
    results = []

    for day, hours in enumerate(days, start=1):
        if hours < 0:
            raise ValueError("Sun hours cannot be negative.")

        generation = (
            config.panel_w * hours * config.efficiency / 1000
        )
        load = config.daily_load_kwh

        available = battery + generation
        unserved = max(0.0, load - available)
        remaining = max(0.0, available - load)

        curtailed = max(0.0, remaining - capacity)
        battery = min(capacity, remaining)

        results.append({
            "day": day,
            "sun_hours": hours,
            "generation_kwh": round(generation, 3),
            "load_kwh": round(load, 3),
            "battery_kwh": round(battery, 3),
            "unserved_kwh": round(unserved, 3),
            "curtailed_kwh": round(curtailed, 3),
        })

    return results


config = SolarConfig()
sun_hours = [5, 4, 2, 6, 3, 5, 1]

records = simulate(sun_hours, config, initial_kwh=0.0)

for row in records:
    print(
        f"Day {row['day']}: "
        f"battery={row['battery_kwh']:.2f} kWh, "
        f"unserved={row['unserved_kwh']:.2f} kWh, "
        f"curtailed={row['curtailed_kwh']:.2f} kWh"
    )

print(
    "Total unserved:",
    round(sum(r["unserved_kwh"] for r in records), 2),
    "kWh"
)
print(
    "Total curtailed:",
    round(sum(r["curtailed_kwh"] for r in records), 2),
    "kWh"
)
